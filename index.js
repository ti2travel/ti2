const express = require('express');
const createMiddleware = require('swagger-express-middleware');
const { connector } = require('swagger-routes-express');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
const { pickBy } = require('ramda');

const schema = yaml.load(fs.readFileSync(`${__dirname}/api.yml`));

const auth = require('./auth/authHandler');
const pingController = require('./controllers/ping');
const adminController = require('./controllers/admin');
const appController = require('./controllers/app');
const userController = require('./controllers/user');
const bookingsController = require('./controllers/bookings');

module.exports = ({
  apiDocs = true,
  elasticLogIndex = 'apilog_ti2',
  elasticLogsClient,
  plugins: pluginsParam = {},
  port: portParam,
  startServer = true,
}) => {
  const port = portParam || process.env.PORT || 10010;
  const app = express();
  const plugins = Object.entries(pluginsParam).map(([pluginName, Plugin]) => {
    // pass all env variables
    const pluginEnv = pickBy(
      (_val, key) => key.substring(0, `ti2_${pluginName}`.length)
        .replace('-', '_') === `ti2_${pluginName}`,
      process.env,
    );
    const params = {};
    Object.entries(pluginEnv).forEach(([attr, value]) => {
      const nuName = attr.replace(/_/g, '-').replace(`ti2-${pluginName}-`, '');
      params[nuName] = value;
    });
    return new Plugin({ name: pluginName, ...params });
  });
  // console.log({ plugins });
  const api = {
    ...pingController,
    ...adminController,
    ...appController,
    ...userController(plugins),
    ...bookingsController(plugins),
  }; // mehthods that should map to the yaml api spec
  createMiddleware(schema, app, (_err, middleware) => {
    if (apiDocs) {
      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(schema));
    }
    app.use(
      middleware.metadata(),
      middleware.CORS(),
      middleware.parseRequest(),
      // middleware.validateRequest(),
    );
    const connect = connector(api, schema, {
      security: auth,
    });
    if (elasticLogsClient) { // API request logs are saved on elastic
      // setup the index
      elasticLogsClient.indices.existsTemplate({
        name: 'apilog',
      }).then(async ({ body }) => {
        if (!body) {
          // the template has to be created
          console.log('=- creating index template -=');
          await elasticLogsClient.indices.putTemplate({
            name: 'apilog',
            body: {
              index_patterns: [`${elasticLogIndex}*`],
              settings: {
                number_of_shards: 1,
              },
              mappings: {
                dynamic: true,
                properties: {
                  body: { type: 'object' },
                  client: { type: 'keyword' },
                  date: { type: 'long' },
                  method: { type: 'keyword' },
                  params: { type: 'object' },
                  query: { type: 'object' },
                  url: { type: 'text' },
                  responseStatusCode: { type: 'long' },
                  responseTimeInMs: { type: 'long' },
                },
              },
            },
          });
        }
        const exists = await elasticLogsClient.indices.exists({
          index: elasticLogIndex,
        });
        if (!exists || !exists.body) {
          console.log('=- creating index =-');
          await elasticLogsClient.indices.create({
            index: elasticLogIndex,
          });
        }
      }).catch(console.log);
      app.use((req, res, next) => {
        const startHrTime = process.hrtime();
        const body = {
          date: Math.floor(Date.now() / 1e3),
          url: req.url,
          // body: req.body,
          params: req.pathParams,
          query: req.query,
          appRecord: req.appRecord,
          method: req.method,
          client: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        };
        elasticLogsClient.index({
          index: elasticLogIndex,
          body,
        }).then(({ body: { _id } }) => {
          res.on('finish', () => {
            const elapsedHrTime = process.hrtime(startHrTime);
            const responseTimeInMs = parseInt(elapsedHrTime[0] * 1e3 + elapsedHrTime[1] / 1e6, 10);
            elasticLogsClient.index({
              index: elasticLogIndex,
              id: _id,
              body: {
                ...body,
                ...{
                  responseTimeInMs,
                  responseStatusCode: res.statusCode,
                },
              },
            }).catch((err, response) => console.log(err, response));
          });
        }).catch((err, response) => console.log(err, response));
        next();
      });
    }
    connect(app);
    app.use(middleware.mock());
    // global error Handling
    app.use((err, req, res, next) => {
      // console.log(req.headers.['X-Request-Id'], err);
      res.status(err.status || 500);
      return res.json({
        message: err.message || 'Internal Error',
      });
    });
  });

  if (startServer) {
    app.listen(port, () => console.log(`ti2 waiting on port ${port}`));
  }
  // first create a generic "terminator"
  const terminator = sig => {
    if (typeof sig === 'string') {
      console.log('%s: Received %s - terminating ti2 ...',
        Date(Date.now()), sig);
      process.exit(1);
    }
    console.log('%s: Node server stopped.', Date(Date.now()));
  };

  // then implement it for every process signal related to exit/quit
  [
    'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
    'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM',
  ].forEach(element => {
    process.on(element, () => { terminator(element); });
  });

  return app;
}

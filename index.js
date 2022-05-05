const express = require('express');
const createMiddleware = require('swagger-express-middleware');
const { connector } = require('swagger-routes-express');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
const { pickBy } = require('ramda');
const bb = require('bluebird');
const { Op } = require('sequelize');
const R = require('ramda');

const schema = yaml.load(fs.readFileSync(`${__dirname}/api.yml`));

const auth = require('./auth/authHandler');
const pingController = require('./controllers/ping');
const adminController = require('./controllers/admin');
const appController = require('./controllers/app');
const userController = require('./controllers/user');
const bookingsController = require('./controllers/bookings');
const { Integration } = require('./models');
const cache = require('./cache');

// src : https://github.com/ramda/ramda/issues/3137#issuecomment-1016012904
const rebuild = fn => obj =>
  Object.fromEntries(Object.entries(obj).flatMap(([k, v]) => fn(k, v)));

module.exports = async ({
  apiDocs = true,
  elasticLogIndex = 'apilog_ti2',
  elasticLogsClient,
  plugins: pluginsParam = {},
  port: portParam,
  startServer = true,
  worker = false,
}) => {
  const port = portParam || process.env.PORT || 10010;
  // create the plugin instances
  const plugins = await bb.map(Object.entries(pluginsParam), async ([pluginName, Plugin]) => {
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
    const pluginInstance = await new Plugin({ name: pluginName, ...params });
    return pluginInstance;
  });
  if (worker) {
    return require('./worker/index')({ plugins });
  }
  // make sure all plugins have a DB entry
  const pluginNames = plugins.map(R.prop('name'));
  const matchedIntegrations = await Integration.findAll({
    attributes: ['name'],
    where: {
      name: {
        [Op.in]: pluginNames,
      },
    },
    raw: true,
  });
  const missingIntegrations = R.difference(pluginNames, matchedIntegrations.map(R.prop('name')));
  if (missingIntegrations.length > 0) {
    // need to crete the missing integrations
    await Integration.bulkCreate(missingIntegrations.map(name => ({
      name,
      packageName: `ti2-${name}`,
      adminEmail: `ti2+${name}@localhost.local`,
    })));
  }
  // create the API Web server
  const app = express();
  const api = {
    ...pingController,
    ...adminController,
    ...appController,
    ...userController(plugins),
    ...bookingsController(plugins),
    cache: R.omit(['cache'], cache),
  }; // mehthods that should map to the yaml api spec
  app.plugins = plugins;
  // add the plugin schema to the schema
  const appControllers = {};
  const allSchema = plugins.filter(e => e.schema).reduce((prev, { schema: currSchema, name }) => {
    appControllers[name] = R.uniq(R.pluck(['operationId'])(R.flatten(Object.values(currSchema.paths || {}).map(Object.values))));
    const newSchema = R.modifyPath(
      ['paths'],
      rebuild(
        (attr, val) => {
          const newVal = {};
          Object.entries(val).forEach(([pathAttr, pathValue]) => {
            newVal[pathAttr] = R.modifyPath(['operationId'], operationName => `${name}_${operationName}`, pathValue);
          });
          return [[`/apps/${name}${attr}`, newVal]];
        },
      ),
      currSchema,
    );
    return R.mergeDeepLeft(prev, newSchema);
  }, schema);
  Object.entries(appControllers).forEach(([name, actions]) => {
    actions.forEach(action => {
      const thePlugin = plugins.find(({ name: pluginName }) => pluginName === name);
      api[`${name}_${action}`] = thePlugin[action]({ plugins, api });
    });
  });
  createMiddleware(allSchema, app, (_err, middleware) => {
    if (apiDocs) {
      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(allSchema));
    }
    app.use(
      middleware.metadata(),
      middleware.CORS(),
      middleware.parseRequest(),
      // middleware.validateRequest(),
    );
    const connect = connector(api, allSchema, {
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
    app.use((err, req, res) => {
      // console.log(req.headers.['X-Request-Id'], err);
      res.status(err.status || 500);
      if ((process.env.JEST_WORKER_ID)) {
        console.debug(err);
      }
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
      console.log(
        '%s: Received %s - terminating ti2 ...',
        Date(Date.now()),
        sig,
      );
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
};

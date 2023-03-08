const express = require('express');
const compression = require('compression');
const createMiddleware = require('swagger-express-middleware');
const { connector } = require('swagger-routes-express');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const hash = require('object-hash');
const fs = require('fs');
const { pickBy } = require('ramda');
const bb = require('bluebird');
const { Op } = require('sequelize');
const R = require('ramda');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('eventemitter2');

const cacheSettings = {
  '*': [
    'tokenTemplate',
    'getAffiliateAgents',
    'getAffiliateDesks',
    'getPickupPoints',
    'bookingsProductSearch',
  ],
  ventrata: [],
  fareharbor: [],
};
const ti2Events = new EventEmitter({ captureRejections: true, wildcard: true });
ti2Events.on('event error', console.error);
ti2Events.on('error', console.error);

const schema = yaml.load(fs.readFileSync(`${__dirname}/api.yml`));

const auth = require('./auth/authHandler');
const pingController = require('./controllers/ping');
const adminController = require('./controllers/admin');
const appController = require('./controllers/app');
const userController = require('./controllers/user');
const bookingsController = require('./controllers/bookings');
const allotmentController = require('./controllers/allotment');
const { Integration } = require('./models');
const cache = require('./cache');

// src : https://github.com/ramda/ramda/issues/3137#issuecomment-1016012904
const rebuild = fn => obj =>
  Object.fromEntries(Object.entries(obj).flatMap(([k, v]) => fn(k, v)));

const isNumber = value => !Number.isNaN(Number(value));

module.exports = async ({
  apiDocs = true,
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
    const pluginInstance = await new Plugin({ name: pluginName, events: ti2Events, ...params });
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
  const matchedIntegrationsNames = matchedIntegrations.map(R.prop('name'));
  const missingIntegrations = R.difference(pluginNames, matchedIntegrationsNames);
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
    ...appController(plugins),
    ...userController(plugins),
    ...bookingsController(plugins),
    ...allotmentController(plugins),
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
    app.use(compression());
    const connect = connector(api, allSchema, {
      security: auth,
      notFound: (req, res) => res.sendStatus(404),
      notImplemented: (req, res) => res.sendStatus(501),
    });
    const eventHandlerPlugins = plugins.filter(currentPlugin => (api.getAllFuncs(currentPlugin).indexOf('eventHandler') > -1));
    eventHandlerPlugins.forEach(plugin => {
      plugin.eventHandler(ti2Events);
    });
    const composeBodyFromReq = req => {
      const requestId = uuidv4();
      return {
        requestId,
        date: Math.floor(Date.now() / 1e3),
        url: req.url,
        body: req.body,
        params: req.pathParams,
        query: req.query,
        appRecord: req.appRecord,
        method: req.method,
        operationId: R.path(['openapi', 'operation', 'operationId'], req),
        client: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      };
    };
    app.use(async (req, res, next) => {
      const startHrTime = process.hrtime();
      const body = composeBodyFromReq(req);
      req.customBody = body;
      ti2Events.emit('request.start', body);
      req.requestId = body.requestId;
      res.on('finish', async () => {
        const elapsedHrTime = process.hrtime(startHrTime);
        const responseTimeInMs = parseInt(
          elapsedHrTime[0] * 1e3 + elapsedHrTime[1] / 1e6,
          10,
        );
        ti2Events.emit('request.end', {
          ...body,
          cacheKey: req.cacheKey,
          responseTimeInMs,
          responseStatusCode: res.statusCode,
        });
      });
      next();
    });

    app.use(async (req, res, next) => {
      try {
        const currentPlugin = plugins.find(p => p.name === req.pathParams.appKey);
        const cachingOperations = [
          ...cacheSettings['*'],
          ...(currentPlugin ? R.pathOr([], [currentPlugin.name], cacheSettings) : []),
        ];
        const body = req.customBody;
        if (cachingOperations.indexOf(body.operationId) > -1) {
          const cacheKey = hash(R.omit(['requestId', 'date'], body));
          req.cacheKey = cacheKey;
          const foundCache = await cache.get({
            pluginName: body.params.appKey,
            key: cacheKey,
          });
          if (foundCache) {
            // console.log('foundCache', cacheKey);
            res.json(foundCache);
          }
          const realSend = res.json;
          res.json = newData => { // new res.json
            cache.save({
              pluginName: req.pathParams.appKey,
              key: cacheKey,
              value: newData,
              ttl: 60 * 60 * 24, // one day
            });
            // console.log('newData', cacheKey);
            if (!res.headersSent) {
              // console.log('send new data', cacheKey);
              return realSend.apply(res, [newData]);
            }
          };
        }
        return next();
      } catch (err) {
        return next(err);
      }
    });
    connect(app);
    app.use(middleware.mock());
    // global error Handling
    app.use((err, req, res, next) => {
      if (res.headersSent) {
        return next(err);
      }
      if (process.env.CONSOLE_ERRORS || process.env.JEST_WORKER_ID) {
        console.error(R.path(['response', 'data'], err), err);
      }
      console.log('hit hre');
      return res.status((() => {
        if (!isNumber(err.status)) return 500;
        return Number(err.status);
      })()).send({
        message: R.path(['response', 'data', 'errorMessage'], err) || err.message || 'Internal Error',
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

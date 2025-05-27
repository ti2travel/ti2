/* global afterAll */

const chance = require('chance').Chance();
const request = require('supertest');
const assert = require('assert');
const createMiddleware = require('swagger-express-middleware');
const bb = require('bluebird');

const appReq = require('../index');
const Plugin = require('./plugin');
const slugify = require('./slugify');
const sqldb = require('../models/db');

const jwt = require('jsonwebtoken');
const { env: { adminKey, jwtSecret } } = process;

const createUserToken = (userId) => jwt.sign({ userId }, jwtSecret);

afterAll(async () => {
  await sqldb.connectionManager.close();
});
module.exports = async (appParams = {}) => {
  const { openApiSpec } = appParams;
  const plugins = (() => {
    if (Array.isArray(appParams.plugins)) {
      const retVal = {};
      appParams.plugins.forEach(pluginName => {
        retVal[pluginName] = Plugin;
      });
      return retVal;
    }
    return {
      mockName: Plugin,
    };
  })();
  const app = await appReq({
    startServer: false,
    ...appParams,
    plugins,
  });

  // Set up swagger middleware with the OpenAPI spec
  if (openApiSpec) {
    app.openApiSpec = openApiSpec;
    const middleware = await bb.promisify(createMiddleware)(openApiSpec);
    const auth = require('../auth/authHandler');
    app.use(
      middleware.metadata(),
      middleware.CORS(),
      middleware.parseRequest(),
    );
    // Set up auth middleware
    app.use((req, res, next) => {
      const securityRequirements = req.swagger && req.swagger.security;
      if (!securityRequirements) return next();
      
      // Check if endpoint requires admin or user auth
      const hasAdminOrUser = securityRequirements.some(sec => 
        (sec.bearerAuth && sec.bearerAuth.includes('admin')) || (sec.bearerAuth && sec.bearerAuth.includes('user'))
      );
      
      if (hasAdminOrUser) {
        return auth['admin,user'](req, res, next);
      }
      next();
    });
  }

  const doApi = async ({
    query,
    verb,
    payload,
    url,
    token,
    expectStatusCode = 200,
    rawResponse = false,
  }) => {
    let resp;
    if (token) {
      resp = await request(app)[verb](url)
        .set({ Authorization: `Bearer ${token}` })
        .query(query)
        .send(payload);
    } else {
      resp = await request(app)[verb](url).query(query).send(payload);
    }
    if (resp.statusCode !== expectStatusCode) {
      const error = new Error();
      error.response = {
        status: resp.statusCode,
        data: resp.body
      };
      throw error;
    }
    if (rawResponse) return resp;
    return resp.body;
  };

  const doApiGet = params => doApi({ ...params, verb: 'get' });
  const doApiPost = params => doApi({ ...params, verb: 'post' });
  const doApiPut = params => doApi({ ...params, verb: 'put' });
  const doApiDelete = params => doApi({ ...params, verb: 'delete' });

  const appSetup = async ({ userId: userIdParam, appName: appNameParam } = {}) => {
    const userId = userIdParam || chance.guid();
    const appName1 = appNameParam || slugify(
      chance.company(),
    ).toLowerCase();
    const newApp = {
      name: appName1,
      packageName: `ti2-${appName1}`,
      adminEmail: chance.email(),
    };
    const apiKey1 = chance.guid();
    const token = {
      endpoint: chance.url(),
      apiKey: apiKey1,
    };
    
    let appKey;
    
    // Only create a new app if appNameParam is not provided
    if (!appNameParam) {
      const { body: { value: newAppKey } } = await request(app)
        .post('/app')
        .set('Authorization', `Bearer ${adminKey}`)
        .send(newApp);
      appKey = newAppKey;
    } else {
      // If appNameParam is provided, we'll use the adminKey directly
      // This avoids the need for a GET /app/{appName} endpoint
      appKey = adminKey;
    }
    
    // Create user token for the app
    await request(app)
      .post(`/${newApp.name}/${userId}`)
      .set('Authorization', `Bearer ${appKey}`)
      .send({
        tokenHint: token.apiKey.split('-')[0],
        token,
      });
    
    return {
      newApp,
      token,
      appKey,
      userId,
    };
  };

  return {
    app,
    appSetup,
    doApiDelete,
    doApiGet,
    doApiPost,
    doApiPut,
    createUserToken,
    slugify,
    plugins: app.plugins,
  };
};

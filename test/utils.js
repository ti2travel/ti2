/* global afterAll */

const chance = require('chance').Chance();
const request = require('supertest');
const assert = require('assert');

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

  const appSetup = async ({ userId: userIdParam, appName: appNameParam, token: tokenDataParam, tokenHint: hintParam } = {}) => {
    const userId = userIdParam || chance.guid();
    const appName = appNameParam || slugify(chance.company()).toLowerCase();

    const integrationDetails = { // Details for the Integration (app) to be created/ensured
      name: appName,
      packageName: `ti2-${appName}`, // Default package name
      adminEmail: chance.email(),   // Default admin email
    };

    // Ensure the Integration (app) record exists.
    // POST /app is an admin endpoint to create an Integration.
    // This call ensures the 'Integrations' table has the required 'appName'.
    // It's assumed this endpoint can be called safely even if the integration already exists.
    await request(app)
      .post('/app')
      .set('Authorization', `Bearer ${adminKey}`) // Admin key to authorize Integration creation
      .send(integrationDetails)
      .expect(200); // Or handle potential non-200 responses if it errors on duplicate

    // Prepare the token content for the UserAppKey.
    // If tokenDataParam is provided by the test, use it; otherwise, generate default content.
    const userAppKeyTokenContent = tokenDataParam || {
      endpoint: chance.url(),
      apiKey: chance.guid(),
    };

    // Determine the hint for the UserAppKey.
    // If hintParam is provided, use it; otherwise, derive from apiKey or generate a random word.
    const hint = hintParam || (userAppKeyTokenContent.apiKey ? userAppKeyTokenContent.apiKey.split('-')[0] : chance.word({ length: 8 }));
    
    // Create the UserAppKey, linking the user to the integration with specific token data and hint.
    // This call depends on the Integration (appName) existing.
    await request(app)
      .post(`/${appName}/${userId}`) // URL uses the Integration's name (appName)
      .set('Authorization', `Bearer ${adminKey}`) // Admin key to authorize UserAppKey creation
      .send({
        tokenHint: hint,
        token: userAppKeyTokenContent, // This is the data to be stored in UserAppKey.appKey (will be encrypted)
      })
      .expect(200); // Expect success for UserAppKey creation
    
    return {
      newApp: integrationDetails, // Information about the integration that was ensured/created
      token: userAppKeyTokenContent,  // The plaintext content that was intended for UserAppKey.appKey
      userId,
      hint,
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
    sqldb, // Expose sqldb for direct DB interaction if needed in tests (e.g., cleanup)
  };
};

/* global jest */

const chance = require('chance').Chance();
const request = require('supertest');
const assert = require('assert');
const appReq = require('../index');
const Plugin = require('./plugin');
const slugify = require('./slugify');

// jest.mock('./plugin');

const pluginMock = require('../controllers/__mocks__/plugin');

const { env: { adminKey } } = process;

const timeout = ms => (new Promise(resolve => setTimeout(resolve, ms)));

const getRequireMocks = ({ jest, app: { name } }) => {
  // create the mock dependencies
  const mock = jest.mock(`ti2-${name}`, () => ({
    ...pluginMock(),
  }), { virtual: true });
  return require(`ti2-${name}`);
};

// source : https://gist.github.com/codeguy/6684588

module.exports = (appParams = {}) => {
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
  const app = appReq({
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
    // if (resp.statusCode !== 200) assert.strictEqual(resp, `${url}-${expectStatusCode}`);
    assert.strictEqual(`${url}-${resp.statusCode}`, `${url}-${expectStatusCode}`);
    if (rawResponse) return resp;
    return resp.body;
  };

  const doApiGet = params => doApi({ ...params, verb: 'get' });
  const doApiPost = params => doApi({ ...params, verb: 'post' });
  const doApiPut = params => doApi({ ...params, verb: 'put' });
  const doApiDelete = params => doApi({ ...params, verb: 'delete' });

  const appSetup = async ({ userId: userIdParam } = {}) => {
    const userId = userIdParam || chance.guid();
    const appName1 = slugify(
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
    const { body: { value: appKey } } = await request(app)
      .post('/app')
      .set('Authorization', `Bearer ${adminKey}`)
      .send(newApp);
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
    appSetup,
    doApiDelete,
    doApiGet,
    doApiPost,
    doApiPut,
    getRequireMocks,
    slugify,
    timeout,
    Plugin,
  };
};

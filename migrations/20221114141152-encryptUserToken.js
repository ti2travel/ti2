/* eslint-disable no-restricted-syntax */
const jwt = require('jsonwebtoken');
const R = require('ramda');
const assert = require('assert');
const sqldb = require('../models/index');

const { encrypt, decrypt } = require('../lib/security');

const { env: { dbCryptoKey } } = process;

module.exports = {
  up: async () => {
    // encrypt all data
    try {
      const existingTokens = await sqldb.UserAppKey.findAll({
        attributes: ['id', 'appKey', 'userId', 'integrationId', 'hint', 'createdAt', 'updatedAt'],
      });
      const valuesToUpdate = [];
      for (const currentToken of existingTokens) {
        const decodedToken = JSON.stringify(R.omit(
          ['iat'],
          jwt.verify(currentToken.dataValues.appKey, dbCryptoKey),
        ));
        const encryptedToken = encrypt(decodedToken);
        // make sure we can decrypt it
        const decodedValue = decrypt(encryptedToken);
        assert(R.equals(decodedToken, decodedValue));
        currentToken.appKey = encryptedToken;
        valuesToUpdate.push({
          id: currentToken.id,
          appToken: encryptedToken,
        });
      }
      for (const { id, appToken } of valuesToUpdate) {
        const currentToken = await sqldb.UserAppKey.findOne({
          where: { id },
          attributes: ['id', 'appKey', 'userId', 'integrationId', 'hint', 'createdAt', 'updatedAt'],
        });
        currentToken.setDataValue('appKey', appToken);
        await currentToken.save();
      }
    } catch (err) {
      console.error(err);
      throw err;
    }
  },
  down: async () => {
    const existingTokens = await sqldb.UserAppKey.findAll();
    for (const currentToken of existingTokens) {
      const decodedToken = decrypt(currentToken.dataValues.appKey);
      const jwtToken = jwt.sign(decodedToken, dbCryptoKey);
      currentToken.setDataValue('appKey', jwtToken);
      await currentToken.save();
    }
  },
};

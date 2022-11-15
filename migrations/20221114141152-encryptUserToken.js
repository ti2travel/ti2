const jwt = require('jsonwebtoken');
const R = require('ramda');
const assert = require('assert');
const sqldb = require('../models/index');

const { encrypt, decrypt } = require('../lib/security');

const { env: { dbCryptoKey } } = process;

module.exports = {
  up: async () => {
    // encrypt all data
    const existingTokens = await sqldb.UserAppKey.findAll();
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
      const currentToken = await sqldb.UserAppKey.findOne({ where: { id } });
      currentToken.setDataValue('appKey', appToken);
      await currentToken.save();
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

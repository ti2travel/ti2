const crypto = require('crypto');
const Sequelize = require('sequelize');
const db = require('./db');

const { env: { dbCryptoKey } } = process;
const generateKey = () => {
  const newKey = `${crypto.randomBytes(5).toString('base64').replace(/\W/g, '')}.${crypto.randomBytes(32).toString('base64').replace(/\W/g, '')}`;
  return newKey;
};

const encrypt = text => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(dbCryptoKey, 'base64'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString('hex')}%${encrypted.toString('hex')}`;
};

const decrypt = text => {
  const iv = Buffer.from(text.split('%')[0], 'hex');
  const encryptedText = Buffer.from(text.split('%')[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(dbCryptoKey, 'base64'), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

const Integration = db.define('Integration', {
  name: {
    type: Sequelize.STRING,
    primaryKey: true,
    allowNull: false,
    validate: {
      is: /^((?!true|false|TRUE|FALSE).){1,255}$/,
    },
  },
  packageName: Sequelize.STRING,
  adminEmail: Sequelize.STRING,
  apiKey: {
    type: Sequelize.STRING,
    defaultValue: () => {
      const newKey = generateKey();
      return encrypt(newKey);
    },
  },
  lastSeen: Sequelize.INTEGER,
}, {
  paranoid: true,
  getterMethods: {
    apiKey() {
      if (!this.getDataValue('apiKey')) { // there is no secret, probably is a combined request
        return generateKey();
      }
      return decrypt(this.getDataValue('apiKey'));
    },
  },
  setterMethods: {
    apiKey(value) {
      return encrypt(value);
    },
  },
});

Integration.associate = models => {
  Integration.hasMany(models.UserAppKey, {
    foreignKey: 'integrationId',
  });
};
Integration.generateKey = generateKey;

module.exports = Integration;

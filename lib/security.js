const crypto = require('crypto');

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

module.exports = {
  generateKey,
  encrypt,
  decrypt,
};

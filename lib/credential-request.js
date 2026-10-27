const { configureAxiosSSL } = require('./sslConfig');

const createCredentialClient = (app, requestId) => configureAxiosSSL(
  app.axios.create({ headers: { requestId } }),
  process.env.SSL_INSECURE_ALLOWED_DOMAINS,
);

const redactCredentialError = (err, message) => {
  if (!err || !err.isAxiosError) return err;
  const error = new Error(message);
  const status = Number(err.response && err.response.status);
  error.status = Number.isInteger(status) && status >= 400 && status <= 599
    ? status : (err.code === 'ECONNABORTED' ? 504 : 502);
  return error;
};

module.exports = { createCredentialClient, redactCredentialError };

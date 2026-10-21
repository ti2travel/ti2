const { UserAppKey } = require('../models');

const tourplanRequestTimeout = () => {
  const configured = Number(process.env.TOURPLAN_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120 * 1000;
};

// The shared plugin client has no timeout. Bound this invoice call without changing its defaults.
const invoiceAxios = pluginAxios => config => pluginAxios({
  timeout: tourplanRequestTimeout(),
  ...config,
});

const pluginPayload = body => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const payload = { ...body };
  delete payload.backgroundJob;
  delete payload.callbackUrl;
  return payload;
};

// Axios errors keep the posted body on `config`. Replace them before they reach the logger.
const clientError = error => {
  if (!error || typeof error !== 'object' || !error.isAxiosError) return error;
  const status = Number(error.response && error.response.status);
  const upstreamMessage = error.response && error.response.data
    && error.response.data.errorMessage;
  const safe = new Error(
    typeof upstreamMessage === 'string' && upstreamMessage
      ? upstreamMessage
      : 'Tourplan NX invoice request failed',
  );
  if (Number.isInteger(status) && status >= 400 && status <= 599) safe.status = status;
  else safe.status = error.code === 'ECONNABORTED' ? 504 : 502;
  return safe;
};

const invoiceOperation = (plugins, method, unavailableMessage) => async (req, res, next) => {
  try {
    const { userId, hint } = req.params;
    const plugin = plugins.find(item => item.name === 'tourplannx');
    if (!plugin || typeof plugin[method] !== 'function') {
      return res.status(501).json({ message: unavailableMessage });
    }
    const integration = await UserAppKey.findOne({
      where: { userId, integrationId: 'tourplannx', hint },
    });
    if (!integration) return res.status(404).json({ message: 'Tourplan NX integration not found' });

    const result = await plugin[method]({
      axios: invoiceAxios(plugin.axios),
      token: await integration.token,
      userId,
      hint,
      payload: pluginPayload(req.body),
    });
    return res.json(result);
  } catch (error) {
    return next(clientError(error));
  }
};

module.exports = plugins => ({
  createCreditorInvoice: invoiceOperation(
    plugins,
    'createCreditorInvoice',
    'Tourplan NX invoice posting is unavailable',
  ),
  checkCreditorInvoice: invoiceOperation(
    plugins,
    'checkCreditorInvoice',
    'Tourplan NX invoice status is unavailable',
  ),
});

const axios = require('axios');

/**
 * Send operation results to a callback URL
 * @param {Object} params - Parameters for the callback
 * @param {string} params.callbackUrl - URL to send the callback to
 * @param {string} params.operationId - ID of the operation that was performed
 * @param {Object} params.payload - The payload that was received
 * @param {Object} params.result - The result of the operation
 * @param {string} params.userId - User ID associated with the request
 * @param {string} params.integrationId - Integration ID associated with the request
 * @param {string} params.hint - Hint used in the request
 * @returns {Promise<void>}
 */
async function sendCallback({
  callbackUrl,
  operationId,
  payload,
  result,
  userId,
  integrationId,
  hint
}) {
  if (!callbackUrl) {
    return;
  }

  const callbackPayload = {
    operationId,
    payload,
    result,
    userId,
    integrationId,
    hint,
    timestamp: new Date().toISOString()
  };

  try {
    await axios.post(callbackUrl, callbackPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    if (error.response) {
      console.error(`Callback to ${callbackUrl} failed with status ${error.response.status}`);
    } else {
      console.error(`Error sending callback to ${callbackUrl}:`, error);
    }
  }
}

module.exports = {
  sendCallback
};

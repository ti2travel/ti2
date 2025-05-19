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
  request,
  result,
}) {
  if (!callbackUrl) {
    return;
  }

  const callbackPayload = {
    request,
    result,
    timestamp: new Date().toISOString()
  };

  try {
    await axios.post(callbackUrl, callbackPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
  } catch (error) {
    let errorMessage = `Error sending callback to ${callbackUrl}: ${error.message}`;
    if (error.code) {
      errorMessage += ` (Code: ${error.code})`;
    }
    if (error.syscall) {
      errorMessage += ` (Syscall: ${error.syscall})`;
    }
    if (error.address && error.port) {
      errorMessage += ` (Address: ${error.address}:${error.port})`;
    }
    console.error(errorMessage);
  }
}

module.exports = {
  sendCallback
};

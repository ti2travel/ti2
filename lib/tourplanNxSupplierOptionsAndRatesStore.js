/* eslint-disable no-await-in-loop, no-restricted-syntax */
// Mutating retries must renew deletion protection before each HTTP attempt.
const axios = require('axios');

const storageError = (code, statusCode) => {
  let message = 'Supplier options and rates storage is unavailable. Retry the operation.';
  if ([401, 403].includes(statusCode)) message = 'Supplier options and rates storage access was denied.';
  if (code === 'SupplierRetentionNotConfigured') {
    message = 'Configure the supplier storage 35-day lifecycle rule before refreshing.';
  }
  return Object.assign(new Error(message), {
    code,
    statusCode,
    status: [401, 403].includes(statusCode) ? statusCode : 503,
    supplierOptionsAndRatesStoreError: true,
  });
};

const createSupplierOptionsAndRatesStore = ({
  endpoint, authorization, writesEnabled = false, http = axios,
}) => {
  if (!endpoint || !authorization) throw new Error('Supplier options and rates storage requires Filematch authorization');
  const request = async (method, path, {
    data, params, signal, beforeAttempt,
  } = {}) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (beforeAttempt) await beforeAttempt();
      try {
        return await http.request({
          method,
          url: `${endpoint}${path}`,
          data,
          params,
          signal,
          timeout: 120000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          responseType: method === 'get' ? 'arraybuffer' : 'json',
          headers: {
            Authorization: authorization,
            ...(data && { 'Content-Type': 'application/octet-stream' }),
          },
        });
      } catch (error) {
        if (axios.isCancel(error) || (signal && signal.aborted)) throw error;
        const { response } = error;
        let detail = response && response.data;
        if (Buffer.isBuffer(detail)) {
          try { detail = JSON.parse(detail.toString('utf8')); } catch (_) { detail = null; }
        }
        const status = Number(response && response.headers && response.headers['x-supplier-storage-status'])
          || (detail && detail.storageStatus) || (response && response.status);
        const code = (detail && detail.code) || error.code || 'SupplierOptionsAndRatesStorageUnavailable';
        if (code === 'SupplierRetentionNotConfigured') throw storageError(code, status);
        if (response && response.status === 404 && method === 'head' && path === '/status') {
          throw Object.assign(new Error('Deploy the Filematch supplier options and rates routes before cleanup.'), {
            code: 'SupplierOptionsAndRatesRouteUnavailable',
            status: 502,
            statusCode: 404,
            supplierOptionsAndRatesStoreError: true,
          });
        }
        if (response && response.status === 404 && (code === 'SupplierOptionsAndRatesMissing'
          || (response.headers && response.headers['x-supplier-options-and-rates-missing'] === 'true'))) return null;
        const retryable = !response || response.status === 429 || response.status >= 500;
        if (attempt === 2 || !retryable || [401, 403].includes(status)) {
          throw storageError(code, status);
        }
        await new Promise(resolve => { setTimeout(resolve, 200 * (2 ** attempt)); });
      }
    }
    return null;
  };
  const pointerParams = pointer => (pointer && pointer.body && pointer.body.store === 's3'
    && typeof pointer.body.bucket === 'string' && typeof pointer.body.key === 'string'
    && typeof pointer.version === 'string'
    ? { bucket: pointer.body.bucket, key: pointer.body.key, version: pointer.version } : null);
  return {
    writesEnabled,
    async checkAvailability() {
      await request('head', '/status');
    },
    async put(cacheKey, value, signal) {
      const response = await request('post', '/objects', {
        signal,
        params: {
          cacheKey,
          version: value.version,
          fetchedAt: value.fetchedAt,
          cacheTtlSeconds: value.cacheTtlSeconds,
        },
        data: JSON.stringify(value),
      });
      const pointer = response.data;
      if (!pointerParams(pointer) || pointer.version !== value.version) {
        throw storageError('InvalidSupplierPointer', 502);
      }
      return pointer;
    },
    async size(pointer, signal) {
      const params = pointerParams(pointer);
      if (!params) return null;
      if (Number.isSafeInteger(pointer.body.byteLength) && pointer.body.byteLength > 0) {
        return pointer.body.byteLength;
      }
      const result = await request('head', '/objects', { params, signal });
      return result ? Number(result.headers['content-length']) || null : null;
    },
    async get(pointer, signal) {
      const params = pointerParams(pointer);
      if (!params) return null;
      const response = await request('get', '/objects', { params, signal });
      if (!response || !response.data || !response.data.length) return null;
      let body;
      try { body = JSON.parse(response.data.toString('utf8')); } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
      return body && Array.isArray(body.options) && Array.isArray(body.suppliers)
        && body.version === pointer.version && Number.isFinite(body.fetchedAt)
        && Number.isFinite(body.cacheTtlSeconds) ? body : null;
    },
    async deletePrefixes(prefixes, assertProtection) {
      const hashes = prefixes.filter(value => /^products_v3_[a-f0-9]{16}$/.test(value))
        .map(value => value.slice('products_v3_'.length));
      for (const hash of new Set(hashes)) {
        let continuationToken;
        do {
          const response = await request('delete', `/hashes/${hash}`, {
            params: { continuationToken }, beforeAttempt: assertProtection,
          });
          continuationToken = response.data.continuationToken;
        } while (continuationToken);
      }
    },
  };
};

let configuredStore;
const getSupplierOptionsAndRatesStore = () => {
  if (configuredStore) return configuredStore;
  const eventsURL = process.env.ti2_events2url_eventsURL;
  const authorization = process.env.ti2_events2url_authorization;
  const writesEnabled = process.env.TI2_SUPPLIER_OPTIONS_AND_RATES_WRITES === 'true';
  if (!eventsURL || !authorization) {
    if (writesEnabled) throw new Error('Supplier options and rates writes require the Filematch service connection');
    return null;
  }
  const url = new URL(eventsURL);
  url.pathname = '/internal/ti2/supplier-options-and-rates';
  url.search = '';
  url.hash = '';
  configuredStore = createSupplierOptionsAndRatesStore({
    endpoint: url.toString().replace(/\/$/, ''),
    authorization,
    writesEnabled,
  });
  return configuredStore;
};

module.exports = { createSupplierOptionsAndRatesStore, getSupplierOptionsAndRatesStore };

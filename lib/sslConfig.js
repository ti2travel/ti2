const https = require('https');
const { URL } = require('url');

/**
 * Creates an HTTPS agent with SSL verification disabled
 */
const createInsecureAgent = () => new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Checks if a URL's domain is in the allowed insecure domains list
 * @param {string} url - The URL to check
 * @param {string} allowedDomains - Pipe-separated list of allowed domains
 * @returns {boolean} True if the domain is allowed to skip SSL verification
 */
const isDomainAllowedInsecure = (url, allowedDomains) => {
  if (!allowedDomains || !url) return false;
  
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const domains = allowedDomains.split('|').map(d => d.trim().toLowerCase()).filter(Boolean);
    
    return domains.some(domain => {
      // Exact match or subdomain match
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch (error) {
    // Invalid URL, don't allow insecure
    return false;
  }
};

/**
 * Configures an axios instance to allow insecure SSL for specific domains
 * @param {Object} axiosInstance - The axios instance to configure
 * @param {string} allowedDomains - Pipe-separated list of allowed domains (from env var)
 * @returns {Object} The configured axios instance
 */
const configureAxiosSSL = (axiosInstance, allowedDomains) => {
  if (!allowedDomains) return axiosInstance;
  
  const insecureAgent = createInsecureAgent();
  
  // Add request interceptor to conditionally apply insecure agent
  axiosInstance.interceptors.request.use(
    (config) => {
      if (config.url && isDomainAllowedInsecure(config.url, allowedDomains)) {
        config.httpsAgent = insecureAgent;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );
  
  return axiosInstance;
};

module.exports = {
  configureAxiosSSL,
  isDomainAllowedInsecure,
};
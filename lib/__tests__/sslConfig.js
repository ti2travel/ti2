const axios = require('axios');
const { configureAxiosSSL, isDomainAllowedInsecure } = require('../sslConfig');

describe('SSL Configuration', () => {
  describe('isDomainAllowedInsecure', () => {
    it('should return false when no domains are allowed', () => {
      expect(isDomainAllowedInsecure('https://example.com', '')).toBe(false);
      expect(isDomainAllowedInsecure('https://example.com', null)).toBe(false);
      expect(isDomainAllowedInsecure('https://example.com', undefined)).toBe(false);
    });

    it('should match exact domain', () => {
      const allowedDomains = 'localhost|staging.example.com';
      expect(isDomainAllowedInsecure('https://localhost/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://staging.example.com/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://production.example.com/api', allowedDomains)).toBe(false);
    });

    it('should match subdomain', () => {
      const allowedDomains = 'example.com';
      expect(isDomainAllowedInsecure('https://api.example.com/endpoint', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://staging.api.example.com/endpoint', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://example.com/endpoint', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://different.com/endpoint', allowedDomains)).toBe(false);
    });

    it('should handle IP addresses', () => {
      const allowedDomains = '192.168.1.100|10.0.0.1';
      expect(isDomainAllowedInsecure('https://192.168.1.100:8080/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://10.0.0.1/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://192.168.1.101/api', allowedDomains)).toBe(false);
    });

    it('should be case insensitive', () => {
      const allowedDomains = 'EXAMPLE.COM|LocalHost';
      expect(isDomainAllowedInsecure('https://example.com/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://EXAMPLE.COM/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://localhost/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://LOCALHOST/api', allowedDomains)).toBe(true);
    });

    it('should handle invalid URLs gracefully', () => {
      const allowedDomains = 'example.com';
      expect(isDomainAllowedInsecure('not-a-url', allowedDomains)).toBe(false);
      expect(isDomainAllowedInsecure('', allowedDomains)).toBe(false);
      expect(isDomainAllowedInsecure(null, allowedDomains)).toBe(false);
    });

    it('should handle whitespace in domain list', () => {
      const allowedDomains = ' localhost | staging.example.com | 192.168.1.100 ';
      expect(isDomainAllowedInsecure('https://localhost/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://staging.example.com/api', allowedDomains)).toBe(true);
      expect(isDomainAllowedInsecure('https://192.168.1.100/api', allowedDomains)).toBe(true);
    });
  });

  describe('configureAxiosSSL', () => {
    it('should not modify axios when no domains are configured', () => {
      const axiosInstance = axios.create();
      const originalInterceptors = axiosInstance.interceptors.request.handlers.length;
      
      configureAxiosSSL(axiosInstance, '');
      expect(axiosInstance.interceptors.request.handlers.length).toBe(originalInterceptors);
      
      configureAxiosSSL(axiosInstance, null);
      expect(axiosInstance.interceptors.request.handlers.length).toBe(originalInterceptors);
    });

    it('should add request interceptor when domains are configured', () => {
      const axiosInstance = axios.create();
      const originalInterceptors = axiosInstance.interceptors.request.handlers.length;
      
      configureAxiosSSL(axiosInstance, 'localhost|example.com');
      expect(axiosInstance.interceptors.request.handlers.length).toBe(originalInterceptors + 1);
    });

    it('should set httpsAgent for allowed domains', async () => {
      const axiosInstance = axios.create();
      configureAxiosSSL(axiosInstance, 'localhost|staging.example.com');
      
      // Test the interceptor by creating a mock config
      const config = { url: 'https://localhost/api' };
      const interceptor = axiosInstance.interceptors.request.handlers[0];
      
      if (interceptor && interceptor.fulfilled) {
        const modifiedConfig = await interceptor.fulfilled(config);
        expect(modifiedConfig.httpsAgent).toBeDefined();
        expect(modifiedConfig.httpsAgent.options.rejectUnauthorized).toBe(false);
      }
    });

    it('should not set httpsAgent for non-allowed domains', async () => {
      const axiosInstance = axios.create();
      configureAxiosSSL(axiosInstance, 'localhost|staging.example.com');
      
      // Test the interceptor by creating a mock config
      const config = { url: 'https://production.example.com/api' };
      const interceptor = axiosInstance.interceptors.request.handlers[0];
      
      if (interceptor && interceptor.fulfilled) {
        const modifiedConfig = await interceptor.fulfilled(config);
        expect(modifiedConfig.httpsAgent).toBeUndefined();
      }
    });

    it('should return the same axios instance', () => {
      const axiosInstance = axios.create();
      const result = configureAxiosSSL(axiosInstance, 'localhost');
      expect(result).toBe(axiosInstance);
    });
  });
});
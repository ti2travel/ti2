/* globals beforeAll describe it expect jest afterAll beforeEach */

const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const { sendCallback } = require('../callback');

describe('callback', () => {
  let mock;

  beforeAll(() => {
    mock = new MockAdapter(axios);
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mock.reset();
    jest.clearAllMocks();
  });

  describe('sendCallback', () => {
    it('should not do anything if callbackUrl is not provided', async () => {
      const consoleSpy = jest.spyOn(console, 'error');
      await sendCallback({
        request: {
          operationId: 'test',
          payload: { test: true },
          userId: '123',
          integrationId: 'test-integration',
          hint: 'test-hint'
        },
        result: { success: true },
      });
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should send a POST request to the callback URL with correct payload', async () => {
      const callbackUrl = 'https://api.example.com/callback';
      const params = {
        callbackUrl,
        request: {
          operationId: 'bookingsProductSearch',
          payload: { searchInput: 'test' },
          userId: '123',
          integrationId: 'test-integration',
          hint: 'test-hint'
        },
        result: { products: [] }
      };

      mock.onPost(callbackUrl).reply((config) => {
        const data = JSON.parse(config.data);
        expect(data).toMatchObject({
          request: params.request,
          result: params.result,
          timestamp: expect.any(String)
        });
        return [200];
      });

      await sendCallback(params);
      expect(mock.history.post.length).toBe(1);
      expect(mock.history.post[0].url).toBe(callbackUrl);
    });

    it('should log error when callback request fails', async () => {
      const callbackUrl = 'https://api.example.com/callback';
      const params = {
        callbackUrl,
        request: {
          operationId: 'bookingsProductSearch',
          payload: { searchInput: 'test' },
          userId: '123',
          integrationId: 'test-integration',
          hint: 'test-hint'
        },
        result: { products: [] }
      };

      mock.onPost(callbackUrl).reply(500);

      // Mock console.error but prevent actual logging
      const originalError = console.error;
      console.error = jest.fn();
      
      await sendCallback(params);
      
      expect(mock.history.post.length).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        `Error sending callback to ${callbackUrl}: Request failed with status code 500`
      );
      
      // Restore original console.error
      console.error = originalError;
    });

    it('should log error when network error occurs', async () => {
      const callbackUrl = 'https://api.example.com/callback';
      const params = {
        callbackUrl,
        request: {
          operationId: 'bookingsProductSearch',
          payload: { searchInput: 'test' },
          userId: '123',
          integrationId: 'test-integration',
          hint: 'test-hint'
        },
        result: { products: [] }
      };

      mock.onPost(callbackUrl).networkError();

      // Mock console.error but prevent actual logging
      const originalError = console.error;
      console.error = jest.fn();
      
      await sendCallback(params);
      
      expect(mock.history.post.length).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        `Error sending callback to ${callbackUrl}: Network Error`
      );
      
      // Restore original console.error
      console.error = originalError;
    });
  });
});

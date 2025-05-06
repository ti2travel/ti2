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
        operationId: 'test',
        payload: { test: true },
        result: { success: true },
        userId: '123',
        integrationId: 'test-integration',
        hint: 'test-hint'
      });
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should send a POST request to the callback URL with correct payload', async () => {
      const callbackUrl = 'https://api.example.com/callback';
      const params = {
        callbackUrl,
        operationId: 'bookingsProductSearch',
        payload: { searchInput: 'test' },
        result: { products: [] },
        userId: '123',
        integrationId: 'test-integration',
        hint: 'test-hint'
      };

      mock.onPost(callbackUrl).reply((config) => {
        const data = JSON.parse(config.data);
        expect(data).toMatchObject({
          operationId: params.operationId,
          payload: params.payload,
          result: params.result,
          userId: params.userId,
          integrationId: params.integrationId,
          hint: params.hint,
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
        operationId: 'bookingsProductSearch',
        payload: { searchInput: 'test' },
        result: { products: [] },
        userId: '123',
        integrationId: 'test-integration',
        hint: 'test-hint'
      };

      mock.onPost(callbackUrl).reply(500);

      const consoleSpy = jest.spyOn(console, 'error');
      await sendCallback(params);
      
      expect(mock.history.post.length).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        `Callback to ${callbackUrl} failed with status 500`
      );
      consoleSpy.mockRestore();
    });

    it('should log error when network error occurs', async () => {
      const callbackUrl = 'https://api.example.com/callback';
      const params = {
        callbackUrl,
        operationId: 'bookingsProductSearch',
        payload: { searchInput: 'test' },
        result: { products: [] },
        userId: '123',
        integrationId: 'test-integration',
        hint: 'test-hint'
      };

      mock.onPost(callbackUrl).networkError();

      const consoleSpy = jest.spyOn(console, 'error');
      await sendCallback(params);
      
      expect(mock.history.post.length).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        `Error sending callback to ${callbackUrl}:`,
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});

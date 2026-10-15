const axios = require('axios');
require('../../test/utils');

// Mock throng to directly execute the worker function
jest.mock('throng', () => jest.fn(config => {
  if (typeof config.worker === 'function') {
    // Provide dummy id and disconnect function, similar to how throng would call it
    config.worker('test-worker-id', jest.fn()); 
  } else {
    console.error('Mocked throng: config.worker is not a function or not provided.');
    // Optionally, throw an error or handle as appropriate for your tests
    // throw new Error('Throng mock expected a worker function in config.');
  }
  // throng can return a promise or be void, depending on usage. Here, we don't need to return.
}));

// Mock axios
jest.mock('axios');

// Mock the queue to avoid actual Redis operations
jest.mock('../queue', () => {
  const original = jest.requireActual('../queue');
  return {
    ...original,
    queue: {
      ...original.queue,
      process: jest.fn(),
      getJob: jest.fn(),
    },
  };
});

// Mock the queue module
jest.mock('../queue', () => {
  const original = jest.requireActual('../queue');
  return {
    ...original,
    queue: {
      ...original.queue,
      process: jest.fn(),
      getJob: jest.fn().mockResolvedValue({
        id: 'test-job-id',
        data: {
          type: 'api',
          method: 'POST',
          url: '/products/testAppKey/testUserId/testTokenHint/search',
          headers: { 'content-type': 'application/json' },
          payload: { backgroundJob: true },
          inTesting: true
        },
        remove: jest.fn().mockResolvedValue(true)
      })
    },
    addJob: jest.fn().mockResolvedValue('test-job-id'),
    allDone: jest.fn().mockResolvedValue(true),
    saveResult: jest.fn().mockResolvedValue(undefined),
  };
});

// Import the mocked queue and the actual worker module
const {
  addJob,
  queue,
  saveResult,
} = require('../queue');
const actualWorkerModule = require('../index'); // Actual worker module

describe('worker: API job handling', () => {
  let serverUrl;
  let plugins;
  let doApiPost;

  let actualJobHandler;

  beforeAll(async () => {
    // Silence console.log for tests
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Setting up test environment
    
    const testUtilsResult = await require('../../test/utils')({
      plugins: ['mockPlugin'],
      startServer: false,
      worker: false,
    });
    
    plugins = testUtilsResult.plugins;
    // doApiPost might not be used directly if worker uses supertest
    serverUrl = 'http://127.0.0.1:3000'; // This might be for constructing expected URLs
    
    axios.mockImplementation(config => {
      // This mock is for the internal axios call made by the worker
      if (config.url && config.url.includes('/products/testAppKey/testUserId/testTokenHint/search')) {
        return Promise.resolve({
          status: 200,
          data: { success: true, products: [{ productId: 'incidental-product' }] },
        });
      }
      console.error('Unexpected axios call to mock:', config);
      return Promise.reject(new Error(`Unexpected axios call in mock for URL: ${config.url}`));
    });

    // Mock queue.process to capture the handler passed by the actual worker
    queue.process.mockImplementation((...args) => {
      let handlerCallback;
      if (typeof args[args.length - 1] === 'function') {
        handlerCallback = args[args.length - 1];
      } else {
        console.error('queue.process mock called without a handler function', args);
        throw new Error('queue.process mock called without a handler function');
      }
      const queueName = typeof args[0] === 'string' ? args[0] : 'default';
      actualJobHandler = handlerCallback;
    });
    
    // Initializing actual worker module
    actualWorkerModule({ plugins }); // Initialize the actual worker, it should call the mocked queue.process
    // Actual worker module initialized
    
    // Test environment setup complete
  });

  afterAll(() => {
    jest.restoreAllMocks(); // Restores all mocks, including console.log spy
    actualJobHandler = null; // Clear captured handler
  });

  beforeEach(() => {
    saveResult.mockClear();
    axios.post.mockReset();
  });

  it('aborts a stuck API request and saves a visible timeout failure', async () => {
    process.env.API_JOB_TIMEOUT_MS = '30';
    axios.mockImplementationOnce(config => new Promise((resolve, reject) => {
      if (config.signal.aborted) {
        reject(new Error('canceled'));
        return;
      }
      config.signal.addEventListener('abort', () => reject(new Error('canceled')));
    }));
    try {
      await actualJobHandler({ id: 'timeout-job', data: {
        type: 'api', method: 'POST', url: '/products/testAppKey/testUserId/testTokenHint/search',
        headers: {}, payload: { forceRefresh: true },
      } });
      expect(saveResult).toHaveBeenCalledWith({ id: 'timeout-job',
        resultValue: expect.objectContaining({ success: false, code: 504,
          result: { message: expect.stringContaining('timed out') } }) });
    } finally {
      delete process.env.API_JOB_TIMEOUT_MS;
    }
  });

  it('should create a job of type "api" for the product search endpoint and send it to the API server', async () => {
    const listen = jest.spyOn(require('http').Server.prototype, 'listen');
    
    // 1. Test that we can create a job
    const jobData = {
      type: 'api',
      method: 'POST',
      url: '/products/testAppKey/testUserId/testTokenHint/search',
      headers: { 'content-type': 'application/json' },
      payload: { backgroundJob: true },
    };
    
    // Adding job to queue...
    const jobId = await addJob(jobData);
    
    // Basic assertions
    expect(jobId).toBeTruthy();
    expect(typeof jobId).toBe('string');
    
    // Verify addJob was called correctly
    expect(addJob).toHaveBeenCalledWith(jobData);
    
    // Simulate job processing by invoking the captured handler
   // Simulating job processing with captured handler...
    if (!actualJobHandler) {
      throw new Error('Job handler was not captured from queue.process. Worker might not have initialized queue processing correctly.');
    }
    // Construct a mock Bull job object
    const mockJob = {
      data: jobData,
      id: jobId,
      log: jest.fn(),
      progress: jest.fn(),
      update: jest.fn(),
    };
    await actualJobHandler(mockJob);
    expect(listen).toHaveBeenCalledWith(
      { port: 0, host: '127.0.0.1', exclusive: true }, expect.any(Function),
    );
    listen.mockRestore();
    // Job processing simulation complete.
    
    // Verify queue.process was called (to capture the handler)
    expect(queue.process).toHaveBeenCalled();
    
    // Verify the internal API call was made by the worker correctly
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: jobData.method.toLowerCase(), // Ensure method matches job data
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/products\/testAppKey\/testUserId\/testTokenHint\/search$/),
        data: {}, // Payload after R.omit(['backgroundJob'], { backgroundJob: true }) is an empty object
        headers: expect.objectContaining({
          // Axios might add/remove/modify some headers, so be specific about what must be there
          // 'content-type': 'application/json' // This might be set by axios default or omitted if data is empty
        }),
      })
    );
    expect(saveResult).toHaveBeenCalledWith({
      id: jobId,
      resultValue: expect.objectContaining({
        ti2CatalogProductCount: null,
        ti2ReturnedProductCount: null,
      }),
    });
  });

  it('reports committed and returned counts for a full catalog refresh', async () => {
    axios.mockResolvedValueOnce({
      status: 200,
      data: {
        products: [],
        catalogRefreshOutcome: 'empty_result_preserved_cache',
        cacheUpdated: false,
        cachePreserved: true,
        cachedProductCount: 7,
      },
    });
    const job = {
      id: 'catalog-refresh-job',
      data: {
        type: 'api',
        method: 'POST',
        url: '/products/testAppKey/testUserId/testTokenHint/search',
        headers: { 'content-type': 'application/json' },
        payload: { forceRefresh: true, backgroundJob: true },
      },
    };

    await actualJobHandler(job);

    expect(saveResult).toHaveBeenCalledWith({
      id: job.id,
      resultValue: expect.objectContaining({
        ti2CatalogProductCount: 7,
        ti2ReturnedProductCount: 0,
      }),
    });
  });

  it('records the Filematch marker and keeps a saved cache successful if handoff fails', async () => {
    const recordProductCacheSave = jest.fn()
      .mockResolvedValueOnce('metadata-generation')
      .mockRejectedValueOnce(new Error('Filematch unavailable'));
    const events2url = { name: 'events2url', recordProductCacheSave };
    plugins.push(events2url);
    axios.mockResolvedValueOnce({ status: 200, data: {
      catalogRefreshOutcome: 'cache_updated', cacheUpdated: true,
      cachedProductCount: 4, catalogOptionCount: 8, catalogFingerprint: 'a'.repeat(64),
      cacheSavedAt: 1700000000000,
      cacheVersion: 1700000000000000,
    } });
    const job = { id: 'nx-refresh', data: {
      type: 'api', method: 'POST',
      url: '/products/tourplannx/company/Desk%20A/search', headers: {},
      payload: { backgroundJob: true, forceRefresh: true, fullSyncTrigger: 'manual' },
    } };
    try {
      await actualJobHandler(job);
      expect(saveResult).toHaveBeenCalledWith({ id: job.id, resultValue: expect.objectContaining({
        syncMetadataGenerationId: 'metadata-generation',
      }) });
      expect(recordProductCacheSave).toHaveBeenCalledTimes(1);

      saveResult.mockClear();
      axios.mockResolvedValueOnce({ status: 200, data: {
        catalogRefreshOutcome: 'cache_updated', cacheUpdated: true,
        cachedProductCount: 4, catalogOptionCount: 8, catalogFingerprint: 'a'.repeat(64),
        cacheSavedAt: 1700000000001,
        cacheVersion: 1700000000000001,
      } });
      await actualJobHandler(job);
      expect(saveResult).toHaveBeenCalledWith({ id: job.id, resultValue: expect.objectContaining({
        success: true, syncMetadataError: 'Filematch unavailable',
      }) });
    } finally {
      const index = plugins.indexOf(events2url);
      if (index >= 0) plugins.splice(index, 1);
    }
  });
});

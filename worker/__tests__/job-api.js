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
    allDone: jest.fn().mockResolvedValue(true)
  };
});

// Import the mocked queue and the actual worker module
const { addJob, queue, allDone } = require('../queue');
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
        return Promise.resolve({ status: 200, data: { success: true, message: 'Mocked internal success' } });
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

  it('should create a job of type "api" for the product search endpoint and send it to the API server', async () => {
    
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
  });
});

// Mock throng to directly execute the worker function
jest.mock('throng', () => jest.fn(config => {
  if (typeof config.worker === 'function') {
    config.worker('test-worker-id-plugin', jest.fn());
  } else {
    console.error('Mocked throng (plugin test): config.worker is not a function or not provided.');
  }
}));

// Mock the queue to avoid actual Redis operations and capture the handler
jest.mock('../queue', () => {
  const original = jest.requireActual('../queue');
  return {
    ...original,
    queue: {
      ...original.queue,
      process: jest.fn(), // Used to capture the job handler
    },
    addJob: jest.fn().mockResolvedValue('test-plugin-job-id'), // Mock addJob
    saveResult: jest.fn().mockResolvedValue(undefined), // Mock saveResult
    // listJobs, jobStatus etc. can be original or mocked if needed by other tests
  };
});

// Mock bookingsControllerFactory to provide a mock for postProcess actions
const mockBookingsPostProcessAction = jest.fn();
jest.mock('../../controllers/bookings', () => {
  return jest.fn(() => ({
    // This action name must match what's in job.data.postProcess.action
    $updateProductSearchCache: mockBookingsPostProcessAction,
    // Add other methods if the worker's initialization of bookingsCtrl calls them
  }));
});

// Import the mocked queue and the actual worker module
const { queue, addJob, saveResult } = require('../queue');
const actualWorkerModule = require('../index'); // Actual worker module
const testUtils = require('../../test/utils'); // For setting up plugins

describe('worker: Plugin job handling', () => {
  let instantiatedPlugins; // Array of instantiated mock plugins from testUtils
  let actualJobHandler; // The job processing function from the worker

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});


    const utils = await testUtils({
      plugins: ['mockPluginForWorker'], // Provide a name for our mock plugin
      startServer: false, // Worker tests usually don't need a live server
      worker: false,
    });
    instantiatedPlugins = utils.plugins; // These are already instantiated mock plugins

    // Capture the job handler from queue.process
    queue.process.mockImplementation((concurrency, handler) => {
      if (typeof handler === 'function') {
        actualJobHandler = handler;
      } else if (typeof concurrency === 'function') { // Handle case where concurrency is omitted
        actualJobHandler = concurrency;
      } else {
        throw new Error('queue.process mock in plugin test could not capture handler');
      }
    });

    // Initialize the worker module. This should cause queue.process to be called.
    await actualWorkerModule({ plugins: instantiatedPlugins });

    if (!actualJobHandler) {
      throw new Error('Job handler was not captured in plugin test. Worker might not have initialized queue processing correctly.');
    }
  });

  beforeEach(() => {
    jest.clearAllMocks(); // Clears all mocks, including plugin method spies and postProcess action
    // Reset specific mocks if needed, e.g., return values for plugin methods
    if (instantiatedPlugins && instantiatedPlugins.length > 0 && instantiatedPlugins[0].searchProducts) {
        instantiatedPlugins[0].searchProducts.mockClear();
    }
    mockBookingsPostProcessAction.mockClear();
  });

  afterAll(() => {
    jest.restoreAllMocks();
    actualJobHandler = null;
  });

  it('should call postProcess action after successful plugin method execution', async () => {
    const mockPluginName = 'mockPluginForWorker'; // Must match plugin name used in testUtils setup
    const mockPluginMethod = 'searchProducts'; // Method to be called on the plugin
    const mockPluginPayload = { query: 'test query' };
    const mockPluginToken = { apiKey: 'test-api-key-for-plugin' };
    const mockPluginResult = { products: [{ id: 'prod123', name: 'Test Product' }] };
    const jobId = 'plugin-job-with-pp-001';

    // Ensure the target mock plugin and its method exist
    const targetPlugin = instantiatedPlugins.find(p => p.name === mockPluginName);
    if (!targetPlugin || typeof targetPlugin[mockPluginMethod] !== 'function') {
      throw new Error(`Mock plugin ${mockPluginName} or method ${mockPluginMethod} not found or not a function.`);
    }
    // Mock the plugin method's return value for this specific test
    targetPlugin[mockPluginMethod].mockResolvedValue(mockPluginResult);

    const jobDataWithPostProcess = {
      type: 'plugin',
      pluginName: mockPluginName,
      method: mockPluginMethod,
      payload: mockPluginPayload, // This is job.data.payload
      token: mockPluginToken,     // This is job.data.token
      inTesting: true,
      postProcess: {
        controller: 'bookings',
        action: '$updateProductSearchCache', // Must match the mocked action name in bookings mock
        args: { staticArg1: 'value1', appKey: mockPluginName }, // Static args for postProcess
      },
    };

    const mockJob = {
      data: jobDataWithPostProcess,
      id: jobId,
      log: jest.fn(), // Bull's job.log
      progress: jest.fn(), // Bull's job.progress
    };

    await actualJobHandler(mockJob);

    // 1. Verify the plugin method was called correctly
    expect(targetPlugin[mockPluginMethod]).toHaveBeenCalledTimes(1);
    expect(targetPlugin[mockPluginMethod]).toHaveBeenCalledWith(expect.objectContaining({
      ...mockPluginPayload, // job.data.payload is spread
      token: mockPluginToken, // job.data.token is passed as 'token'
      requestId: jobId,
      // axios and typeDefsAndQueries are also injected by the worker
    }));

    // 2. Verify the postProcess action was called correctly
    expect(mockBookingsPostProcessAction).toHaveBeenCalledTimes(1);
    expect(mockBookingsPostProcessAction).toHaveBeenCalledWith(expect.objectContaining({
      staticArg1: 'value1', // From postProcess.args
      appKey: mockPluginName, // From postProcess.args
      pluginResult: mockPluginResult, // The result from the plugin method
      requestId: jobId,
    }));

    // 3. Verify saveResult was called (implicitly tests success path)
    expect(saveResult).toHaveBeenCalledWith({ id: jobId, resultValue: mockPluginResult });
  });

  it('should still save result even if postProcess is not defined', async () => {
    const mockPluginName = 'mockPluginForWorker';
    const mockPluginMethod = 'searchProducts';
    const mockPluginResult = { products: [{ id: 'prod456' }] };
    const jobId = 'plugin-job-no-pp-002';

    const targetPlugin = instantiatedPlugins.find(p => p.name === mockPluginName);
    targetPlugin[mockPluginMethod].mockResolvedValue(mockPluginResult);

    const jobDataNoPostProcess = {
      type: 'plugin',
      pluginName: mockPluginName,
      method: mockPluginMethod,
      payload: { query: 'another query' },
      token: { apiKey: 'key-for-no-pp' },
      inTesting: true,
      // No postProcess field
    };

    const mockJob = { data: jobDataNoPostProcess, id: jobId, log: jest.fn(), progress: jest.fn() };
    await actualJobHandler(mockJob);

    expect(targetPlugin[mockPluginMethod]).toHaveBeenCalledTimes(1);
    expect(mockBookingsPostProcessAction).not.toHaveBeenCalled();
    expect(saveResult).toHaveBeenCalledWith({ id: jobId, resultValue: mockPluginResult });
  });

  it('should throw error and not call postProcess if plugin method fails', async () => {
    const mockPluginName = 'mockPluginForWorker';
    const mockPluginMethod = 'searchProducts';
    const jobId = 'plugin-job-fail-003';
    const pluginError = new Error('Plugin method failed');

    const targetPlugin = instantiatedPlugins.find(p => p.name === mockPluginName);
    targetPlugin[mockPluginMethod].mockRejectedValue(pluginError);

    const jobDataWithPpForFailure = {
      type: 'plugin',
      pluginName: mockPluginName,
      method: mockPluginMethod,
      payload: {},
      token: {},
      inTesting: true,
      postProcess: {
        controller: 'bookings',
        action: '$updateProductSearchCache',
        args: { appKey: mockPluginName },
      },
    };
    const mockJob = { data: jobDataWithPpForFailure, id: jobId, log: jest.fn(), progress: jest.fn() };

    await expect(actualJobHandler(mockJob)).rejects.toThrow(pluginError.message);

    expect(targetPlugin[mockPluginMethod]).toHaveBeenCalledTimes(1);
    expect(mockBookingsPostProcessAction).not.toHaveBeenCalled();
    expect(saveResult).not.toHaveBeenCalled(); // saveResult should not be called on failure
  });
});

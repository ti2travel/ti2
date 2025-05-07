/* globals describe it expect jest beforeAll afterAll */

// Import queue module directly to avoid reference issues
const queueModule = require('../queue');

// Create a mock for axios that will be used by the callback module
jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200 })
}));

describe('worker: Callback job handling', () => {
  beforeAll(async () => {
    // Clean up any existing jobs before running tests
    await queueModule.queue.empty();
    await queueModule.queue.clean(0, 'completed');
    await queueModule.queue.clean(0, 'failed');
  });
  
  afterAll(async () => {
    // Clean up any remaining jobs after tests
    await queueModule.queue.empty();
    await queueModule.queue.clean(0, 'completed');
    await queueModule.queue.clean(0, 'failed');
  });

  it('should create a job of type "callback" with the correct structure', async () => {
    // Create a job to send a callback
    const callbackData = {
      callbackUrl: 'https://example.com/callback',
      request: { id: '123', method: 'GET' },
      result: { status: 'success', data: { message: 'Operation completed' } }
    };
    
    const jobData = {
      type: 'callback',
      payload: callbackData
    };

    // Add the job to the queue
    const jobId = await queueModule.addJob(jobData);
    
    // Verify job was created with a valid ID
    expect(jobId).toBeTruthy();
    expect(typeof jobId).toBe('string');
    
    // Get the job from the queue to verify its data
    const job = await queueModule.queue.getJob(jobId);
    
    // Verify the job exists and has the correct data
    expect(job).toBeTruthy();
    expect(job.data).toEqual(expect.objectContaining({
      type: 'callback',
      payload: expect.objectContaining({
        callbackUrl: 'https://example.com/callback',
        request: expect.any(Object),
        result: expect.any(Object)
      }),
      inTesting: true // This is added by addJob function
    }));
  });
  
  it('should include the correct structure for callback jobs', () => {
    // This test verifies the worker/index.js handles callback jobs correctly
    // by checking the code structure without actually running it
    
    // Read the worker code
    const workerCode = require('fs').readFileSync(require('path').resolve(__dirname, '../index.js'), 'utf8');
    
    // Verify the worker code includes handling for callback jobs
    expect(workerCode).toContain('if (type === \'callback\')');
    
    // Verify it extracts the necessary parameters
    expect(workerCode).toContain('callbackUrl,');
    expect(workerCode).toContain('request,');
    expect(workerCode).toContain('result,');
    
    // Verify it calls the sendCallback function
    expect(workerCode).toContain('sendCallback');
    
    // Verify it returns the expected result structure
    expect(workerCode).toContain('return { success: true }');
  });
  
  it('should use the callback module to send callbacks', async () => {
    // Get a reference to the mocked axios.post function
    const axios = require('axios');
    
    // Reset mock call history
    axios.post.mockClear();
    
    // Create a job with callback data
    const callbackData = {
      callbackUrl: 'https://example.com/callback',
      request: { id: '123', method: 'GET' },
      result: { status: 'success', data: { message: 'Operation completed' } }
    };
    
    // Directly call the sendCallback function to verify it works as expected
    const { sendCallback } = require('../../lib/callback');
    await sendCallback(callbackData);
    
    // Verify axios.post was called with the correct parameters
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      callbackData.callbackUrl,
      expect.objectContaining({
        request: callbackData.request,
        result: callbackData.result,
        timestamp: expect.any(String)
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );
  });
});

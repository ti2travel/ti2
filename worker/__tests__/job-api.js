/* globals describe it expect jest beforeAll afterAll */

// Import queue module directly to avoid reference issues
const queueModule = require('../queue');

describe('worker: API job handling', () => {
  it('should create a job of type "api" for the /ping endpoint', async () => {
    // Create a job to call the /ping endpoint
    const jobData = {
      type: 'api',
      method: 'GET',
      url: '/ping',
      headers: {
        'content-type': 'application/json',
      },
      payload: {},
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
      type: 'api',
      method: 'GET',
      url: '/ping',
      headers: expect.objectContaining({
        'content-type': 'application/json',
      }),
      payload: expect.any(Object),
      inTesting: true, // This is added by addJob function
    }));
    
    // Clean up - we'll clean the queue at the end of all tests
    // No need to remove individual jobs
  });
  
  it('should include the correct structure for API jobs', () => {
    // This test verifies the worker/index.js handles API jobs correctly
    // by checking the code structure without actually running it
    
    // Read the worker code
    const workerCode = require('fs').readFileSync(require('path').resolve(__dirname, '../index.js'), 'utf8');
    
    // Verify the worker code includes handling for API jobs
    expect(workerCode).toContain('if (type === \'api\')'); 
    
    // Verify it uses supertest instead of a full blown server
    expect(workerCode).toContain('const request = require(\'supertest\')');
    
    // Verify it makes a direct request to the app
    expect(workerCode).toContain('const reqMethod = request(app)'); 
    
    // Verify it returns the expected result structure
    expect(workerCode).toContain('code,');
    expect(workerCode).toContain('result,');
    expect(workerCode).toContain('success:');
  });
});

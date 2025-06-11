/* globals beforeAll describe it expect */
const yaml = require('js-yaml');
const fs = require('fs');

// Load environment variables and API schema
const { env: { adminKey } } = process;

describe('cronjobs', () => {
  const testUtils = require('../../test/utils');
  // API helper functions
  let doApiPost;
  let doApiGet;
  let doApiDelete;
  
  // Test data
  let appName;
  let appKey;
  let userId;
  let userToken;
  let userSetup;
  let otherUserId;
  let otherUserToken;
  let otherUserSetup;
  let createdAdminJobId; // To store the ID of the job created by admin
  let createdUserJobId; // To store the ID of the job created by user
  
  // Constants
  const cron = '0 0 * * *';
  const testApiPayload = ({ appKey, userId, hint }, bodyParam = {}) => ({
    url: `/products/${appKey}/${userId}/${hint}/search`,
    method: 'post',
    body: { ...bodyParam },
    cron,
  });

  beforeAll(async () => {
    const { 
      doApiPost: post, 
      doApiGet: get, 
      doApiDelete: del, 
      createUserToken,
      appSetup
    } = await testUtils();

    // Use appSetup to create app and user
    userSetup = await appSetup();
    appName = userSetup.newApp.name;
    appKey = userSetup.appKey;
    userId = userSetup.userId;
    
    // Create user token
    userToken = createUserToken(userId);
    
    // Create another user for cross-user permission tests under the same app
    otherUserSetup = await appSetup({ appName: appName });
    otherUserId = otherUserSetup.userId;
    
    // Create token for other user
    otherUserToken = createUserToken(otherUserId);

    doApiPost = post;
    doApiGet = get;
    doApiDelete = del;
  });

  it('should create a new cronjob as admin', async () => {
    const newJobPayload = testApiPayload(userSetup);
    const response = await doApiPost({
      url: `/cronjobs/${userId}`,
      token: adminKey,
      payload: {...newJobPayload},
    });

    expect(response).toEqual(
      expect.objectContaining({...newJobPayload}),
    );
    createdAdminJobId = response.id; // Changed from bullJobId to id
    expect(createdAdminJobId).toBeTruthy(); // Check the new id variable
  });

  it('should create a new cronjob as user', async () => {
    const response = await doApiPost({
      url: `/cronjobs/${userId}`,
      token: userToken,
      payload: {...testApiPayload(userSetup)},
    });

    expect(response).toEqual(
      expect.objectContaining({...testApiPayload(userSetup)}),
    );
    createdUserJobId = response.id; // Changed from bullJobId to id
    expect(createdUserJobId).toBeTruthy(); // Check the new id variable
  });

  it('should list cronjobs as admin', async () => {
    const { jobs } = await doApiGet({
      url: `/cronjobs/${userId}`,
      token: adminKey,
    });

    expect(Array.isArray(jobs)).toBe(true);
    // Check for admin job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...testApiPayload(userSetup),
          userId,
          id: createdAdminJobId,
        }),
      ]),
    );
    // Check for user job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...testApiPayload(userSetup),
          userId,
          id: createdUserJobId,
        }),
      ]),
    );
  });

  it('should list cronjobs as user', async () => {
    const { jobs } = await doApiGet({
      url: `/cronjobs/${userId}`,
      token: userToken,
    });

    expect(Array.isArray(jobs)).toBe(true);
    // Check for admin job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...testApiPayload(userSetup),
          userId,
          id: createdAdminJobId,
        }),
      ]),
    );
    // Check for user job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...testApiPayload(userSetup),
          userId,
          id: createdUserJobId,
        }),
      ]),
    );
  });

  it('should delete a cronjob as admin', async () => {
    const response = await doApiDelete({
      url: `/cronjobs/${userId}/${createdAdminJobId}`, // Use createdAdminJobId
      token: adminKey,
    });

    expect(response).toEqual({ success: true });

    // Wait for the database to refresh
    await new Promise(resolve => setTimeout(resolve, 2e3));

    // Verify it's deleted
    const { jobs } = await doApiGet({
      url: `/cronjobs/${userId}`,
      token: adminKey,
    });

    // Verify the job is no longer in the list
    const deletedJob = jobs.find(job => job.id === createdAdminJobId); // Check against id and createdAdminJobId
    expect(deletedJob).toBeUndefined();
  });

  it('should delete a cronjob as user', async () => {
    // First create a new cronjob ( new one since we used prev for other test)
    const { id: newJobId } = await doApiPost({
      url: `/cronjobs/${userId}`,
      token: userToken,
      payload: {...testApiPayload(userSetup)},
    });

    const response = await doApiDelete({
      url: `/cronjobs/${userId}/${newJobId}`,
      token: userToken,
    });

    expect(response).toEqual({ success: true });

    // Wait for the database to refresh
    await new Promise(resolve => setTimeout(resolve, 2e3));

    // Verify it's deleted
    const { jobs } = await doApiGet({
      url: `/cronjobs/${userId}`,
      token: adminKey,
    });

    // Check if the job is still in the list
    const deletedJob = jobs.find(job => job.bullJobId === newJobId);
    expect(deletedJob).toBeUndefined();
  });

  it('should fail when user tries to delete another users cronjob', async () => {
    // Use the properly seeded otherUserId and otherUserToken
    let otherJobId;

    // First create a cronjob for the other user as an admin
    const createResponse = await doApiPost({
      url: `/cronjobs/${otherUserId}`,
      token: adminKey,
      payload: {...testApiPayload(otherUserSetup)},
    });

    otherJobId = createResponse.id;
    expect(otherJobId).toBeTruthy();

    // Now try to delete the other user's job with the first user's token
    // This should fail with an error
    try {
      await doApiDelete({
        url: `/cronjobs/${otherUserId}/${otherJobId}`,
        token: userToken,
      });
      // If we get here, the test should fail
      throw new Error('Should have failed with permission error');
    } catch (error) {
      // Verify we got an error response
      expect(error.response).toBeDefined();
      // The exact status code might be 401 or 403 depending on implementation
      expect([401, 403]).toContain(error.response.status);
    }

    // Verify the job still exists (using admin token for consistency)
    const { jobs } = await doApiGet({
      url: `/cronjobs/${otherUserId}`,
      token: adminKey,
    });

    const otherJob = jobs.find(job => job.id === otherJobId);
    expect(otherJob).toBeDefined();
  });

  it('should fail to create cronjob with invalid url', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await doApiPost({
        url: `/cronjobs/${userId}`,
        token: adminKey,
        payload: {
          method: 'GET',
          url: '/invalid/path',
          cron,
        },
      });
      throw new Error('Should have failed');
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.message).toContain('Invalid URL');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('should fail to delete non-existent cronjob', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await doApiDelete({
        url: `/cronjobs/${userId}/nonexistent`,
        token: adminKey,
      });
      throw new Error('Should have failed');
    } catch (error) {
      expect(error.response.status).toBe(404);
      expect(error.response.data.message).toBe('Cronjob not found');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('should execute a scheduled cronjob', async () => {
    const cronExpression = '*/1 * * * *'; // Every minute
    const uniqueId = `${(new Date()).getTime()}`

    const callBackServer = new Promise((resolve, reject) => {
      // Create a temporary HTTP server to receive the callback
      const http = require('http');
      const url = require('url'); // Import the 'url' module
      const port = 44294; // Using a fixed port for test

      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const requestUrl = url.parse(req.url, true);
          const receivedUniqueId = requestUrl.query.date;
          if (receivedUniqueId === uniqueId) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            server.close(() => {
              resolve({ id: response.bullJobId });
            });
          } else {
            // If the uniqueId doesn't match, send a different response.
            // The test will eventually time out if the correct callback doesn't arrive.
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Callback ID mismatch' }));
            // server.close(); // Optionally close server on mismatch to free port sooner
          }
        });
      });

      server.listen(port, '0.0.0.0');
    });

    // Create a cronjob that should execute in the next minute
    // Assuming the test are running on the same host as the worker
    const response = await doApiPost({
      url: `/cronjobs/${userId}`,
      token: adminKey,
      payload: {
        method: 'POST',
        url: `/products/${appName}/${userId}/search`,
        cron: cronExpression,
        payload: {},
        callbackUrl: `http://localhost:44294/callback?date=${uniqueId}`,
        removeOnComplete: true,
      },
    });

    expect(response.bullJobId).toBeTruthy();
    // Wait for the job to execute
    const callBackInstance = await callBackServer;
    expect(callBackInstance.id).toBe(response.bullJobId);

    // Import the queue to check job status
    const { queue } = require('../../worker/queue');

    // Check if the job was removed from the Bull queue
    // It might take a moment for the job to be fully removed after completion
    // try the next command for up to 30s, queue auto-removal can take a bit
    let jobInQueue;
    const maxRetries = 60; // Max 30 retries (e.g. 30 seconds if 1s interval)
    const retryInterval = 1e3; // 1 second interval

    for (let i = 0; i < maxRetries; i++) {
      jobInQueue = await queue.getJob(response.bullJobId);
      if (!jobInQueue) {
        break; // Job removed, exit loop
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }

    expect(jobInQueue).toBeNull();

    // Clean up - remove the cron job from the database
    await doApiDelete({
      url: `/cronjobs/${userId}/${response.id}`,
      token: adminKey,
    });
  }, 120e3); // timeout to wait for the queue to clearout the job
});

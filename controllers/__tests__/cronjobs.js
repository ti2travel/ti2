/* globals beforeAll describe it expect */
const testUtils = require('../../test/utils');
const yaml = require('js-yaml');
const fs = require('fs');

// Load environment variables and API schema
const { env: { adminKey } } = process;
const schema = yaml.load(fs.readFileSync(`${__dirname}/../../api.yml`));

describe('cronjobs', () => {
  // API helper functions
  let doApiPost;
  let doApiGet;
  let doApiDelete;
  
  // Test data
  let appName;
  let appKey;
  let userId;
  let userToken;
  let otherUserId;
  let otherUserToken;
  let bullJobId;
  
  // Constants
  const operationId = 'queryAllotment';
  const userOperationId = 'bookingsProductSearch';
  const cron = '0 0 * * *';
  const adminHint = 'admin-test';
  const userHint = 'user-test';

  beforeAll(async () => {
    const { 
      doApiPost: post, 
      doApiGet: get, 
      doApiDelete: del, 
      createUserToken,
      appSetup
    } = await testUtils({
      openApiSpec: schema
    });

    // Use appSetup to create app and user
    const setup = await appSetup();
    appName = setup.newApp.name;
    appKey = setup.appKey;
    userId = setup.userId;
    
    // Create user token
    userToken = createUserToken(userId);
    
    // Create another user for cross-user permission tests under the same app
    const otherSetup = await appSetup({ appName: appName });
    otherUserId = otherSetup.userId;
    
    // Create token for other user
    otherUserToken = createUserToken(otherUserId);

    doApiPost = post;
    doApiGet = get;
    doApiDelete = del;
  });

  it('should create a new cronjob as admin', async () => {
    const response = await doApiPost({
      url: `/cronjobs/${appName}/${userId}`,
      token: adminKey,
      payload: {
        operationId,
        cron,
        payload: {
          startDate: '01/04/2023',
          endDate: '03/04/2023',
          keyPath: 'MAGLUX|7CQLDACMAGLUXDELSUI',
          hint: adminHint,
        },
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        pluginName: appName,
        userId,
        operationId,
        cron,
      }),
    );
    bullJobId = response.bullJobId;
    expect(bullJobId).toBeTruthy();
  });
  it('should create a new cronjob as user', async () => {
    const response = await doApiPost({
      url: `/cronjobs/${appName}/${userId}`,
      token: userToken,
      payload: {
        operationId: userOperationId,
        cron,
        payload: {
          hint: userHint,
        },
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        pluginName: appName,
        userId,
        operationId: userOperationId,
        cron,
      }),
    );
    expect(response.bullJobId).toBeTruthy();
  });

  it('should list cronjobs as admin', async () => {
    const { jobs } = await doApiGet({
      url: `/cronjobs/${appName}/${userId}`,
      token: adminKey,
    });

    expect(Array.isArray(jobs)).toBe(true);
    // Check for admin job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: appName,
          userId,
          operationId,
          cron,
          bullJobId,
          hint: adminHint
        }),
      ]),
    );
    // Check for user job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: appName,
          userId,
          operationId: userOperationId,
          cron,
          hint: userHint
        }),
      ]),
    );
  });

  it('should list cronjobs as user', async () => {
    const { jobs } = await doApiGet({
      url: `/cronjobs/${appName}/${userId}`,
      token: userToken,
    });

    expect(Array.isArray(jobs)).toBe(true);
    // Check for admin job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: appName,
          userId,
          operationId,
          cron,
          bullJobId,
          hint: adminHint
        }),
      ]),
    );
    // Check for user job
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: appName,
          userId,
          operationId: userOperationId,
          cron,
          hint: userHint
        }),
      ]),
    );
  });

  it('should delete a cronjob as admin', async () => {
    const response = await doApiDelete({
      url: `/cronjobs/${appName}/${userId}/${bullJobId}`,
      token: adminKey,
    });

    expect(response).toEqual({ success: true });

    // Wait for the database to refresh
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify it's deleted
    const { jobs } = await doApiGet({
      url: `/cronjobs/${appName}/${userId}`,
      token: adminKey,
    });

    // Verify the job is no longer in the list
    const deletedJob = jobs.find(job => job.bullJobId === bullJobId);
    expect(deletedJob).toBeUndefined();
  });

  it('should delete a cronjob as user', async () => {
    // First create a new cronjob
    const { bullJobId: newJobId } = await doApiPost({
      url: `/cronjobs/${appName}/${userId}`,
      token: userToken,
      payload: {
        operationId,
        cron,
        payload: {
          startDate: '01/04/2023',
          endDate: '03/04/2023',
          hint: 'delete-test',
        },
      },
    });

    const response = await doApiDelete({
      url: `/cronjobs/${appName}/${userId}/${newJobId}`,
      token: userToken,
    });

    expect(response).toEqual({ success: true });

    // Wait for the database to refresh
    await new Promise(resolve => setTimeout(resolve, 2000));
      
    // Verify it's deleted
    const { jobs } = await doApiGet({
      url: `/cronjobs/${appName}/${userId}`,
      token: adminKey,
    });
      
    // Check if the job is still in the list
    const deletedJob = jobs.find(job => job.bullJobId === newJobId);
      
    // Final verification
    expect(deletedJob).toBeUndefined();
  });

  // Test that a user cannot delete another user's cronjob
  it('should fail when user tries to delete another users cronjob', async () => {
    // Use the properly seeded otherUserId and otherUserToken
    let otherJobId;
    
    // First create a cronjob for the other user as an admin
    const createResponse = await doApiPost({
      url: `/cronjobs/${appName}/${otherUserId}`,
      token: adminKey,
      payload: {
        operationId,
        cron,
        payload: {
          hint: 'permission-test',
        },
      },
    });
    
    otherJobId = createResponse.bullJobId;
    expect(otherJobId).toBeTruthy();
    
    // Now try to delete the other user's job with the first user's token
    // This should fail with an error
    try {
      await doApiDelete({
        url: `/cronjobs/${appName}/${otherUserId}/${otherJobId}`,
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
      url: `/cronjobs/${appName}/${otherUserId}`,
      token: adminKey,
    });
    
    const otherJob = jobs.find(job => job.bullJobId === otherJobId);
    expect(otherJob).toBeDefined();
  });
      
  it('should fail to create cronjob with invalid operationId', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    try {
      await doApiPost({
        url: `/cronjobs/${appName}/${userId}`,
        token: adminKey,
        payload: {
          operationId: 'invalidOperation',
          cron,
        },
      });
      throw new Error('Should have failed');
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.message).toContain("Invalid operationId: 'invalidOperation' not found");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('should fail to delete non-existent cronjob', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await doApiDelete({
        url: `/cronjobs/${appName}/${userId}/nonexistent`,
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
});

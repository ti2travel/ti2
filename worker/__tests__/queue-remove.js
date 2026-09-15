/* globals beforeEach describe expect it jest */

const crypto = require('crypto');

const mockQueue = {
  getJob: jest.fn(),
  getRepeatableJobs: jest.fn(),
  on: jest.fn(),
  removeRepeatableByKey: jest.fn(),
};
const mockRedis = { del: jest.fn() };

jest.mock('bull', () => jest.fn(() => mockQueue));
jest.mock('ioredis', () => jest.fn(() => mockRedis));

jest.resetModules();
const { removeJob } = require('../queue');

const occurrenceId = ({
  name, id, key, timestamp = 1700000000000,
}) => {
  const namespace = crypto.createHash('md5').update(key).digest('hex');
  const repeatHash = crypto.createHash('md5')
    .update(`${name}${id ? `${id}:` : ':'}${namespace}`)
    .digest('hex');
  return `repeat:${repeatHash}:${timestamp}`;
};

describe('removeJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue.getJob.mockResolvedValue(null);
  });

  it('removes only the repeat definition that owns the stored occurrence id', async () => {
    const target = {
      name: '__default__',
      id: 'company-a-tourplan-desk-a',
      key: '__default__:company-a-tourplan-desk-a:::0 9 * * *',
    };
    const sameCronOtherIntegration = {
      name: '__default__',
      id: 'company-a-tourplan-desk-b',
      key: '__default__:company-a-tourplan-desk-b:::0 9 * * *',
    };
    mockQueue.getRepeatableJobs.mockResolvedValue([sameCronOtherIntegration, target]);
    const jobId = occurrenceId(target);

    await removeJob(jobId);

    expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith(target.key);
    expect(mockRedis.del).toHaveBeenCalledWith(jobId);
  });

  it('treats an already-removed repeat definition as an idempotent success', async () => {
    mockQueue.getRepeatableJobs.mockResolvedValue([]);

    await expect(removeJob('repeat:missing:1700000000000')).resolves.toBeUndefined();

    expect(mockQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith('repeat:missing:1700000000000');
  });
});

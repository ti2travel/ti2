jest.mock('../../models', () => ({ UserAppKey: { findOne: jest.fn() } }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { UserAppKey } = require('../../models');
const productFilesArchive = require('../productFilesArchive');

const request = body => ({ params: { app: 'tourplannx', userId: 'company', hint: 'Live' }, body });
const response = () => {
  const res = new PassThrough();
  res.statusCode = 200;
  res.status = code => { res.statusCode = code; return res; };
  res.json = jest.fn(value => { res.body = value; return res; });
  res.setHeader = jest.fn();
  return res;
};

beforeEach(() => UserAppKey.findOne.mockResolvedValue({ token: { url: 'https://nx.test' } }));

it('reports the exporter projection version for this integration', async () => {
  const credential = {};
  Object.defineProperty(credential, 'token', { get: () => { throw new Error('token read'); } });
  UserAppKey.findOne.mockResolvedValueOnce(credential);
  const plugin = { name: 'tourplannx', getProductFilesProjectionVersion: jest.fn(async () => 3) };
  const res = response();
  await productFilesArchive([plugin]).getProductFilesVersion(request(), res, jest.fn());
  expect(res.body).toEqual({ projectionVersion: 3 });
  expect(plugin.getProductFilesProjectionVersion).toHaveBeenCalledTimes(1);
});

it('requires an explicit nonempty usage selection', async () => {
  const handler = productFilesArchive([]).getProductFilesArchive;
  const res = response();
  await handler(request({ selection: 'usage', usage: {} }), res, jest.fn());
  expect(res.statusCode).toBe(400);
});

it('rejects usage IDs that collide after trimming before calling the plugin', async () => {
  const plugin = { name: 'tourplannx', createProductFilesArchive: jest.fn() };
  const handler = productFilesArchive([plugin]).getProductFilesArchive;
  const res = response();
  await handler(request({ selection: 'usage', usage: {
    CPTACSUP001A: { totalHistoricalUses: 1 },
    ' CPTACSUP001A ': { totalHistoricalUses: 2 },
  } }), res, jest.fn());
  expect(res.statusCode).toBe(400);
  expect(plugin.createProductFilesArchive).not.toHaveBeenCalled();
});

it('returns no matching options without streaming an all-products archive', async () => {
  const plugin = { name: 'tourplannx', createProductFilesArchive: jest.fn(async () => ({
    status: 'no_matching_options', selectedOptionCount: 0,
  })) };
  const handler = productFilesArchive([plugin]).getProductFilesArchive;
  const res = response();
  await handler(request({ selection: 'usage', usage: { MISSING: {} } }), res, jest.fn());
  expect(plugin.createProductFilesArchive).toHaveBeenCalledWith(expect.objectContaining({
    selection: 'usage', usage: { MISSING: {} }, userId: 'company', hint: 'Live',
  }));
  expect(res.body.status).toBe('no_matching_options');
});

it('streams the generated archive and removes its temporary file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'product-files-archive-test-'));
  const archivePath = path.join(directory, 'catalog.tar.gz');
  fs.writeFileSync(archivePath, Buffer.from('archive'));
  const cleanup = jest.fn(async () => fs.promises.rm(directory, { recursive: true }));
  const plugin = { name: 'tourplannx', createProductFilesArchive: jest.fn(async () => ({
    status: 'ready', archivePath, cleanup,
  })) };
  const handler = productFilesArchive([plugin]).getProductFilesArchive;
  const res = response();
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  await handler(request({ selection: 'all' }), res, jest.fn());
  expect(Buffer.concat(chunks).toString()).toBe('archive');
  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/gzip');
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(archivePath)).toBe(false);
});

it('reports cleanup failure without failing an already streamed archive', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'product-files-archive-test-'));
  const archivePath = path.join(directory, 'catalog.tar.gz');
  fs.writeFileSync(archivePath, Buffer.from('archive'));
  const cleanupError = new Error('temporary directory could not be removed');
  const plugin = { name: 'tourplannx', createProductFilesArchive: jest.fn(async () => ({
    status: 'ready', archivePath, cleanup: jest.fn(async () => { throw cleanupError; }),
  })) };
  const res = response();
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  const next = jest.fn();
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await productFilesArchive([plugin]).getProductFilesArchive(request({ selection: 'all' }), res, next);
    expect(Buffer.concat(chunks).toString()).toBe('archive');
    expect(next).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('Failed to clean up TourPlan product files archive', cleanupError);
  } finally {
    logError.mockRestore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

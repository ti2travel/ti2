const summarizeRequestBody = require('../request-body-summary');

const invoiceBody = {
  credentials: { cookies: [{ name: 'session', value: 'secret' }] },
  invoice: { lines: [{}, {}] },
  backgroundJob: true,
  callbackUrl: 'https://example.test/hook',
};

test('summarizes product file archive requests by operation id', () => {
  const summary = summarizeRequestBody({
    openapi: { operation: { operationId: 'getProductFilesArchive' } },
    body: { selection: 'usage', usageHash: 'abc', usage: { a: 1, b: 2 } },
  });
  expect(summary).toEqual({ selection: 'usage', usageHash: 'abc', usageCount: 2 });
});

test('summarizes creditor invoice requests by operation id when the path does not match', () => {
  const req = {
    openapi: { operation: { operationId: 'createCreditorInvoice' } },
    path: '/proxy/invoices',
    body: invoiceBody,
  };
  expect(summarizeRequestBody(req)).toEqual({ lineCount: 2 });
  expect(summarizeRequestBody.isCreditorInvoice(req)).toBe(true);
});

test.each(['', '/status', '/preview'])('summarizes creditor invoice requests by path %s when operation metadata is missing', suffix => {
  const req = {
    path: `/invoices/tourplannx/company/desk${suffix}`,
    body: invoiceBody,
  };
  expect(summarizeRequestBody(req)).toEqual({ lineCount: 2 });
  expect(summarizeRequestBody.isCreditorInvoice(req)).toBe(true);
});

test('keeps unrelated request bodies', () => {
  const req = { path: '/bookings/tourplannx/company/search', body: invoiceBody };
  expect(summarizeRequestBody(req)).toBe(invoiceBody);
  expect(summarizeRequestBody.isCreditorInvoice(req)).toBe(false);
});

test.each(['/allotment/plugin/company', '/allotment/plugin/desk/company', '/allotment/plugin/company/'])(
  'does not retain allotment body values in events for %s', path => {
    const req = {
      path,
      method: 'POST',
      body: { ...invoiceBody, keyPath: { credentials: 'secret' }, startDate: 'secret' },
    };
    expect(summarizeRequestBody(req)).toEqual({ hasCredentials: true });
    expect(summarizeRequestBody.isAllotmentPost(req)).toBe(true);
    expect(summarizeRequestBody({ ...req, method: 'GET' })).toBe(req.body);
  },
);

test('uses operation metadata to summarize allotment requests behind a proxy', () => {
  expect(summarizeRequestBody({
    method: 'POST',
    path: '/proxy/allotment',
    openapi: { operation: { operationId: 'queryAllotment' } },
    body: invoiceBody,
  })).toEqual({ hasCredentials: true });
});

test.each([
  '/affiliate/plugin/company/agents',
  '/affiliate/plugin/company/desk/agents',
  '/affiliate/plugin/company/agents/',
  '/affiliate/plugin/company/desk/agents/',
])('does not retain agent body values in events for %s', path => {
  const req = { path, method: 'POST', body: { ...invoiceBody, search: 'private-search' } };
  expect(summarizeRequestBody(req)).toEqual({ hasCredentials: true });
  expect(summarizeRequestBody.isAgentPost(req)).toBe(true);
  expect(summarizeRequestBody({ ...req, method: 'GET' })).toBe(req.body);
  expect(summarizeRequestBody({ ...req, body: {} })).toEqual({ hasCredentials: false });
});

test('uses operation metadata to summarize agent requests behind a proxy', () => {
  const req = {
    method: 'POST',
    path: '/proxy/agents',
    openapi: { operation: { operationId: 'getAffiliateAgents' } },
    body: invoiceBody,
  };
  expect(summarizeRequestBody(req)).toEqual({ hasCredentials: true });
  expect(summarizeRequestBody.isAgentPost(req)).toBe(true);
});

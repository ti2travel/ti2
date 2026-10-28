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

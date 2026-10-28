const invoiceOperationIds = new Set(['createCreditorInvoice', 'checkCreditorInvoice', 'previewCreditorInvoice']);
const invoicePath = /^\/invoices\/tourplannx\/[^/]+\/[^/]+(?:\/(?:status|preview))?$/;

const operationId = req => (
  req.openapi && req.openapi.operation && req.openapi.operation.operationId
);

const invoiceLineCount = req => {
  const lines = req.body && req.body.invoice && req.body.invoice.lines;
  return { lineCount: Array.isArray(lines) ? lines.length : 0 };
};

const isCreditorInvoice = req => (
  invoiceOperationIds.has(operationId(req)) || invoicePath.test(req.path)
);

const summarizeRequestBody = req => {
  if (operationId(req) === 'getProductFilesArchive') {
    return {
      selection: req.body && req.body.selection,
      usageHash: req.body && req.body.usageHash,
      usageCount: req.body && req.body.usage ? Object.keys(req.body.usage).length : 0,
    };
  }
  if (isCreditorInvoice(req)) return invoiceLineCount(req);
  return req.body;
};

summarizeRequestBody.isCreditorInvoice = isCreditorInvoice;

module.exports = summarizeRequestBody;

const R = require('ramda');

const getErrorMessage = ({ err, handlers = [], force = true }) => {
  for (const handler of handlers) {
    let errorMessage;
    if (Array.isArray(handler)) {
      errorMessage = R.path(handler, err);
    } else if (typeof handler === 'function') {
      errorMessage = handler(err);
    }
    if (errorMessage) {
      return errorMessage;
    }
  }
  if (force) return R.pathOr(
    err,
    ['message'],
    err
  );
}
module.exports = getErrorMessage;

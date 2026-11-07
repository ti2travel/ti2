const hash = require('object-hash');

module.exports = ({ userId, hint }) => hash({
  userId,
  hint,
  operationId: 'bookingsProductSearch',
});

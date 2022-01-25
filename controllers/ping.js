/*
  Functions in a127 controllers used for operations should take two parameters:

  Param 1: a handle to the request object
  Param 2: a handle to the response object
  */
const {
  name,
  version,
  description,
} = require('../package.json');

const ping = (_req, res, next) => {
  try {
    return res.json({
      name,
      description,
      version,
      uptime: process.uptime(),
    });
  } catch (err) {
    return next(err);
  } };

module.exports = {
  ping,
};

const buildCorruptedTokenError = ({
  integrationId,
  userId,
  hint,
  cause,
}) => {
  const error = new Error(
    'Stored integration token is invalid. Please re-save credentials.',
  );
  error.name = 'CorruptedTokenError';
  error.code = 'CORRUPTED_TOKEN';
  error.status = 422;
  error.context = {
    integrationId,
    userId,
    hint,
  };
  error.cause = cause;
  return error;
};

module.exports = buildCorruptedTokenError;

module.exports = {
  [process.env.NODE_ENV || 'development']: {
    use_env_variable: 'DB_URL',
  },
};

module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
  },
  extends: [
    'airbnb-base',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'implicit-arrow-linebreak': 0,
    'operator-linebreak': 0,
    'prefer-template': 2,
    'arrow-parens': [
      2,
      'as-needed',
      {
        requireForBlockBody: false,
      },
    ],
    'prefer-arrow-callback': 2,
    'no-unused-vars': [
      2,
      {
        argsIgnorePattern: '^_*$',
      },
    ],
    'no-use-before-define': 0,
    'no-console': 0,
    'new-cap': 0,
    'no-underscore-dangle': [
      'error',
      {
        allow: [
          '_id',
          '__',
          'resource_id',
        ],
      },
    ],
  },
  ignorePatterns: ['**/docs/*'],
};

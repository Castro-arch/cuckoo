import config from '@cuckoo/config/eslint';

export default [
  ...config,
  {
    // The single allowed import site of temporal-polyfill (ADR-0002).
    files: ['src/temporal.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

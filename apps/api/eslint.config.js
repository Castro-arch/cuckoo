import config from '@cuckoo/config/eslint';

export default [
  ...config,
  {
    // Lets consistent-type-imports keep value imports that Nest DI needs at runtime.
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
];

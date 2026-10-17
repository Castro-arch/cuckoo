import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const temporalMessage =
  "Import { Temporal } from '@cuckoo/core' (packages/core/src/temporal.ts inside core). ADR-0002.";

/**
 * Temporal comes only from packages/core/src/temporal.ts, the single re-export of
 * temporal-polyfill, so switching to the native global later touches one file (ADR-0002).
 * Exported separately so configs that do not extend the default one (apps/web) can reuse it.
 */
export const temporalRules = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['temporal-polyfill', 'temporal-polyfill/*', '@js-temporal/polyfill'],
            message: temporalMessage,
          },
        ],
      },
    ],
    'no-restricted-globals': ['error', { name: 'Temporal', message: temporalMessage }],
  },
};

/** Shared flat config for Node/TypeScript packages. */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.next/**', '.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  temporalRules,
);

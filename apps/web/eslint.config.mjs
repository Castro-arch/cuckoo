import { temporalRules } from '@cuckoo/config/eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
  temporalRules,
];

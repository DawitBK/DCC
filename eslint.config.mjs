import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-mirror/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Secrets, tokens and passwords must never be logged (docs/security/SECURITY-STANDARDS.md).
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'portal/backend/test/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Command-line tools print to the terminal by design.
    files: [
      'portal/backend/src/platform/database/migrate-cli.ts',
      'portal/backend/src/platform/database/seed.ts',
      'portal/backend/src/platform/database/dev-session.ts',
      'portal/backend/src/platform/audit/checkpoint-cli.ts',
      'portal/backend/src/platform/crypto/keygen-cli.ts',
    ],
    rules: { 'no-console': 'off' },
  },
);

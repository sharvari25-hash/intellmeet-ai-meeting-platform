import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  // Never lint build output, dependencies or coverage reports.
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.vercel/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  // Baseline for every JS/TS file in the monorepo.
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow intentionally unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Working rule #4: `any` must be justified, so surface it as a warning.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Server + shared run on Node.
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', '*.js', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The server bootstrap legitimately logs to stdout.
    files: ['server/src/server.ts', 'server/src/config/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Client runs in the browser.
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    // shadcn/ui components ship a component plus its cva variant helper from
    // one file by design; that is not a Fast Refresh problem in practice.
    files: ['client/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Tests may use dev-only globals and looser typing.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Must stay last: turns off rules that conflict with Prettier.
  prettier,
);

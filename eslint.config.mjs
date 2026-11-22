import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'web/vendor/**',
      '.venv/**',
      'coverage/**',
      'docs/**',
      '.ai-readiness/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['web/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        marked: 'readonly',
        DOMPurify: 'readonly',
      },
    },
    rules: {
      complexity: ['warn', 20],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'sort-imports': ['off'],
      camelcase: ['warn', { properties: 'never' }],
    },
  },
  {
    files: ['tests/**/*.mjs', 'scripts-tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      complexity: ['warn', 20],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];

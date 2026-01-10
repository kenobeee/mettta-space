import eslintJs from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**']
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json'
      },
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    extends: [
      eslintJs.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off'
    }
  }
);


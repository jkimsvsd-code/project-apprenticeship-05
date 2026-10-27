import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/dist/**',
      '.vercel/**',
      '.npm-cache/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['apps/**/*.tsx'], ...reactHooks.configs.flat.recommended },
  {
    files: [
      'apps/demo/**/*.{ts,tsx}',
      'packages/{document-model,renderer,template-kit,content,policies}/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@jjal/server-*',
                '@jjal/integrations*',
                '**/server-domain/**',
                '**/integrations/**',
              ],
              message: '브라우저 패키지에서 서버 전용 코드를 가져올 수 없습니다.',
            },
          ],
        },
      ],
    },
  },
];

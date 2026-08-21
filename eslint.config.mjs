import tsconfigs from 'eslint-config-salesforce-typescript';
import plugin from 'eslint-plugin-sf-plugin';

const configs = [
  {
    ignores: ['test/package/resources/**/*'],
  },
  ...tsconfigs,
  ...plugin.configs.library,
  {
    files: ['test/**/*'],
    rules: {
      '@typescript-eslint/no-misused-promises': 'off',
      // Allow assert style expressions. i.e. expect(true).to.be.true
      'no-unused-expressions': 'off',

      // It is common for tests to stub out method.
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // Return types are defined by the source code. Allows for quick overwrites.
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Mocked out the methods that shouldn't do anything in the tests.
      '@typescript-eslint/no-empty-function': 'off',
      // Easily return a promise in a mocked method.
      '@typescript-eslint/require-await': 'off',
    },
  },
];

export default configs;

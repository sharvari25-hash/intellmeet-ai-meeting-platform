/**
 * Enforces Conventional Commits (working rule #2) on every commit message
 * via the .husky/commit-msg hook.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'test',
        'docs',
        'refactor',
        'ci',
        'build',
        'perf',
        'style',
        'revert',
      ],
    ],
  },
};

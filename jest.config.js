/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  passWithNoTests: true, // M4: jest exits 1 on zero tests without this; task 1 ships 0 test files
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/', // tsc emits compiled copies to dist; don't run them twice
    '<rootDir>/.stryker-tmp/', // Stryker sandboxes contain full copies of the suite; never run them
    // Task 5 fixtures are INPUTS to collectAnalysis, not jest suites. They are
    // named *.test.ts on purpose (plan task-5 file list + task-10 CLI paths),
    // so the directory is excluded from collection rather than renamed.
    '<rootDir>/tests/fixtures/',
    '<rootDir>/.worktrees/', // git worktree checkouts live inside the repo root; never collect their tests
    '<rootDir>/.opencode/scratch/', // WP1.1 validation scratch projects are real Jest/Vitest suites, not repo suites
  ],
};

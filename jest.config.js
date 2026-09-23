// CommonJS (not .ts) on purpose: this config must be parseable by BOTH the
// system Node and Electron's bundled Node. Jest can only read jest.config.ts
// on runtimes with native type stripping (Node >=22), and Electron 34 ships
// Node 20 — so a .ts config breaks `npm run test:electron`.
//
// Why tests run under Electron: better-sqlite3 is a native module compiled for
// Electron's ABI (132). The system Node is ABI 137, so requiring it there throws
// NODE_MODULE_VERSION. Running Jest inside Electron's Node matches the ABI the
// app actually uses, with no second build of the native module.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  // Abandoned agent worktrees contain full stale copies of tests/ — without
  // this, a run executes every historical copy alongside the real suite.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/', '/out/', '/tests/browser/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.node.json' }],
  },
  // Mock electron's app module for tests
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/helpers/electron-mock.ts',
  },
}

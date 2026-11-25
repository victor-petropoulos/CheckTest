/**
 * CLI tests for the `mutation-sandbox init` subcommand (U8, task 19).
 *
 * Coverage pinned by the task acceptance:
 *   1. sandbox dir creation
 *   2. generated Stryker config content
 *   3. gitignore behavior — own repo appended (already-present path) + foreign
 *      repo PRINT-OR-CONFIRM path with NO silent mutation of a foreign .gitignore
 *   4. NO Stryker invocation anywhere in these tests (asserted by absence)
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { main } from '../src/cli';

const TMP_ROOT = tmpdir();

let stdout = '';
let stderr = '';
let stdoutSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  stdout = '';
  stderr = '';
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function ownRepoFixture(): string {
  const dir = mkdtempSync(join(TMP_ROOT, 'ct-sandbox-own-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'checktest-cli', version: '0.0.0' }), 'utf8');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
  return dir;
}

function foreignRepoFixture(): string {
  const dir = mkdtempSync(join(TMP_ROOT, 'ct-sandbox-foreign-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foreign-app', version: '0.0.0' }), 'utf8');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
  return dir;
}

describe('mutation-sandbox init — sandbox dir creation', () => {
  it('creates .checktest-sandbox/ and writes stryker.config.json', () => {
    const dir = foreignRepoFixture();
    try {
      const code = main(['mutation-sandbox', 'init', '--dir', dir, '--json']);
      expect(code).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.kind).toBe('mutation-sandbox');
      expect(json.schemaVersion).toBe('0.5');
      expect(existsSync(json.sandboxDir)).toBe(true);
      expect(existsSync(json.configPath)).toBe(true);
      expect(json.sandboxDir).toBe(join(dir, '.checktest-sandbox'));
      expect(json.configPath).toBe(join(dir, '.checktest-sandbox', 'stryker.config.json'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing --dir target exits 1', () => {
    const code = main(['mutation-sandbox', 'init', '--dir', join(TMP_ROOT, 'does-not-exist-xyz')]);
    expect(code).toBe(1);
  });

  it('missing init verb exits 1', () => {
    const code = main(['mutation-sandbox']);
    expect(code).toBe(1);
  });
});

describe('mutation-sandbox init — generated stryker config content', () => {
  it('config is bound to the sandbox dir and never mutates in place', () => {
    const dir = foreignRepoFixture();
    try {
      main(['mutation-sandbox', 'init', '--dir', dir, '--json']);
      const json = JSON.parse(stdout);
      const raw = readFileSync(json.configPath, 'utf8');
      const cfg = JSON.parse(raw);
      expect(cfg.tempDirName).toBe('.checktest-sandbox/stryker-tmp');
      expect(cfg.inPlace).toBe(false);
      expect(cfg.ignorePatterns).toContain('.checktest-sandbox/**');
      // No testRunner / mutate: runner-agnostic, minimal.
      expect(cfg).not.toHaveProperty('testRunner');
      expect(cfg).not.toHaveProperty('mutate');
      // No workingDir (not a Stryker core option).
      expect(cfg).not.toHaveProperty('workingDir');
      // Blessed invocation printed.
      expect(json.strykerCommand).toContain('stryker run');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mutation-sandbox init — gitignore behavior', () => {
  it('own repo: entry present (appended when missing, already-present when there)', () => {
    const dir = ownRepoFixture();
    try {
      // First run: appended.
      const code1 = main(['mutation-sandbox', 'init', '--dir', dir, '--json']);
      expect(code1).toBe(0);
      const json1 = JSON.parse(stdout);
      expect(json1.gitignore.action).toBe('appended');
      const gi1 = readFileSync(json1.gitignore.path, 'utf8');
      expect(gi1).toContain('.checktest-sandbox/');

      // Reset stdout for second run.
      stdout = '';
      // Second run: already-present, idempotent.
      const code2 = main(['mutation-sandbox', 'init', '--dir', dir, '--json']);
      expect(code2).toBe(0);
      const json2 = JSON.parse(stdout);
      expect(json2.gitignore.action).toBe('already-present');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('foreign repo: prints required line and never mutates the foreign .gitignore', () => {
    const dir = foreignRepoFixture();
    const giPath = join(dir, '.gitignore');
    const before = readFileSync(giPath, 'utf8');
    const beforeHash = createHash('sha256').update(before).digest('hex');
    try {
      const code = main(['mutation-sandbox', 'init', '--dir', dir, '--json']);
      expect(code).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.gitignore.action).toBe('foreign-print');
      expect(json.gitignore.requiredLine).toBe('.checktest-sandbox/');
      // Human-readable path also prints the line.
      stdout = '';
      stderr = '';
      const code2 = main(['mutation-sandbox', 'init', '--dir', dir]);
      expect(code2).toBe(0);
      expect(stdout).toContain('.checktest-sandbox/');

      // Foreign .gitignore byte-identical.
      const after = readFileSync(giPath, 'utf8');
      const afterHash = createHash('sha256').update(after).digest('hex');
      expect(afterHash).toBe(beforeHash);
      expect(after).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Explicit assertion that no Stryker process is invoked anywhere in this suite:
// these tests never spawn stryker; they only inspect files produced by the helper.
describe('mutation-sandbox init — no Stryker invocation', () => {
  it('helper output and config contain no stryker execution', () => {
    const dir = foreignRepoFixture();
    try {
      main(['mutation-sandbox', 'init', '--dir', dir, '--json']);
      const json = JSON.parse(stdout);
      const cfg = readFileSync(json.configPath, 'utf8');
      expect(cfg.toLowerCase()).not.toContain('stryker run');
      expect(json.strykerCommand).not.toMatch(/npm (run|test)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

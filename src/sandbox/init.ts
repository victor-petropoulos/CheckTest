/**
 * Mutation-sandbox preparation (owner ruling: U8 option (B), 2026-11-23 —
 * `jev/record/mutation-sandbox-guarantee-2026-11-23.md`).
 *
 * Framing constraint (binding): CheckTest NEVER runs Stryker. This module only
 * prepares a safe working area — a gitignored sandbox directory plus a Stryker
 * config whose temp/copy directory lives inside that sandbox — so the user's
 * external mutation tooling has a blessed place to run. Nothing here enforces
 * anything, and no claim of enforcement is made.
 *
 * Reviewer-gate F3: this module owns the sandbox LOGIC; `src/cli.ts` carries
 * dispatch only. Reviewer-gate F7: CheckTest's own `.gitignore` is edited by
 * this unit; a FOREIGN repo's `.gitignore` is never silently mutated — the
 * required line is PRINTED for the user to add (see `planGitignore`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

/** The sandbox directory, relative to the target repository root. */
export const SANDBOX_DIR_NAME = '.checktest-sandbox';

/** The line a repository's `.gitignore` needs so the sandbox stays untracked. */
export const SANDBOX_GITIGNORE_LINE = '.checktest-sandbox/';

/** Where the prepped Stryker config is written, relative to the target root. */
export const STRYKER_CONFIG_PATH = `${SANDBOX_DIR_NAME}/stryker.config.json`;

/**
 * The package name of this CLI (`package.json` `"name"`). A target root whose
 * own `package.json` carries it IS the CheckTest repo, so its `.gitignore` is
 * the one this unit owns and may append to. Anything else is foreign.
 */
export const OWN_PACKAGE_NAME = 'checktest-cli';

export interface SandboxInitOptions {
  /** Target repository root. Defaults to `process.cwd()`. */
  dir?: string;
}

export type GitignoreAction = 'appended' | 'already-present' | 'foreign-print';

export interface SandboxInitResult {
  /** Absolute, resolved target repository root. */
  dir: string;
  /** Absolute path of the created sandbox directory. */
  sandboxDir: string;
  /** Absolute path of the written Stryker config. */
  configPath: string;
  gitignore: {
    /** Absolute path of the `.gitignore` the decision applies to. */
    path: string;
    action: GitignoreAction;
    /** The exact line required (always reported, printed verbatim when foreign). */
    requiredLine: string;
  };
  /** Blessed Stryker invocation for the produced config. */
  strykerCommand: string;
}

/**
 * Stryker config bound to the sandbox. Minimal on purpose (ponytail-lite):
 * `tempDirName` is Stryker's sandbox — the directory that receives copies of
 * the source during a mutation run (schema default `.stryker-tmp`,
 * `node_modules/@stryker-mutator/core/schema/stryker-schema.json`) — and
 * `inPlace: false` keeps Stryker mutating the copy, never the tracked tree.
 * `ignorePatterns` keeps the sandbox itself out of the copy. No `testRunner`
 * and no `mutate`: both stay project-specific, so the config is
 * runner-agnostic and never over-configured.
 *
 * `workingDir` is deliberately absent: it is not a Stryker core option (not in
 * the schema above) and would be silently ignored.
 */
export function buildStrykerConfig(): string {
  return `${JSON.stringify(
    {
      tempDirName: `${SANDBOX_DIR_NAME}/stryker-tmp`,
      inPlace: false,
      ignorePatterns: [`${SANDBOX_DIR_NAME}/**`, 'coverage/**', 'dist/**'],
      reporters: ['progress', 'json'],
    },
    null,
    2,
  )}\n`;
}

/** True when `root` is the CheckTest repo itself (its package.json names it). */
export function isOwnRepo(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
    return pkg.name === OWN_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/**
 * Prepare the mutation sandbox in `options.dir`.
 *
 * Order: resolve the root → create the sandbox dir → write the config → settle
 * the `.gitignore`. The `.gitignore` step NEVER writes to a foreign repo: for
 * a foreign root the result reports `foreign-print` and the caller prints
 * `requiredLine`; the file is left byte-identical.
 */
export function initMutationSandbox(options: SandboxInitOptions = {}): SandboxInitResult {
  const dir = resolve(options.dir ?? process.cwd());
  if (!existsSync(dir)) {
    throw new Error(`checktest: mutation-sandbox dir does not exist: ${dir}`);
  }

  const sandboxDir = join(dir, SANDBOX_DIR_NAME);
  mkdirSync(sandboxDir, { recursive: true });

  const configPath = join(dir, STRYKER_CONFIG_PATH);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, buildStrykerConfig(), 'utf8');

  const gitignorePath = join(dir, '.gitignore');
  let action: GitignoreAction;
  if (isOwnRepo(dir)) {
    action = appendGitignoreEntry(gitignorePath);
  } else {
    // F7: never silently mutate a foreign tracked file. Report the required
    // line; the CLI prints it for the user to add by hand.
    action = 'foreign-print';
  }

  return {
    dir,
    sandboxDir,
    configPath,
    gitignore: { path: gitignorePath, action, requiredLine: SANDBOX_GITIGNORE_LINE },
    strykerCommand: `npx stryker run --configFile ${STRYKER_CONFIG_PATH}`,
  };
}

/**
 * Append the sandbox line to the repo's own `.gitignore`, idempotently.
 * A missing `.gitignore` is created; an existing entry (any line whose
 * trimmed text equals the required line) is left untouched.
 */
function appendGitignoreEntry(gitignorePath: string): GitignoreAction {
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const lines = existing.split('\n');
  if (lines.some((line) => line.trim() === SANDBOX_GITIGNORE_LINE)) {
    return 'already-present';
  }
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, `${existing}${separator}${SANDBOX_GITIGNORE_LINE}\n`, 'utf8');
  return 'appended';
}

/** Absolute-path guard re-exported for the CLI layer's `--dir` validation. */
export function resolveSandboxDir(value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value);
}

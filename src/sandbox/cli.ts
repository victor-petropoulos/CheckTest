/**
 * CLI adapter for the `mutation-sandbox` subcommand. All sandbox LOGIC lives in
 * `./init.ts`; this module is arg parsing + output only.
 */

import { initMutationSandbox, resolveSandboxDir } from './init';

export const MUTATION_SANDBOX_USAGE = [
  'Usage: checktest mutation-sandbox init [--dir <path>] [--json]',
  '',
  '  init          create a gitignored sandbox dir + prepped Stryker config',
  '  --dir <path>  target repository root (default: current working directory)',
  '  --json        emit machine-readable JSON (kind: mutation-sandbox)',
  '',
  'Creates `.checktest-sandbox/` with a Stryker config bound to it',
  '(tempDirName inside the sandbox, inPlace: false) and reports the required',
  '`.gitignore` line. CheckTest never runs Stryker: this only prepares the safe',
  'working area. For a foreign repository the required `.gitignore` line is',
  'printed and the foreign `.gitignore` is left untouched.',
].join('\n');

export interface MutationSandboxCliArgs {
  json: boolean;
  dir?: string;
}

export function parseMutationSandboxArgs(args: readonly string[]): MutationSandboxCliArgs {
  let json = false;
  let dir: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--json') {
      json = true;
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      throw new MutationSandboxHelp();
    }
    if (flag !== '--dir') {
      throw new MutationSandboxUsageError(`unknown argument '${flag}'`);
    }
    const value = args[i + 1];
    if (value === undefined) {
      throw new MutationSandboxUsageError(`missing value for '${flag}'`);
    }
    dir = value;
    i += 1;
  }
  return { json, dir };
}

class MutationSandboxUsageError extends Error {}
class MutationSandboxHelp extends Error {}

export { MutationSandboxUsageError };

/**
 * @returns process exit code (0 = prepared, 1 = usage error).
 */
export function runMutationSandbox(args: readonly string[]): number {
  // Subcommand dispatch: `mutation-sandbox init ...`. `init` is the only
  // supported action today; anything else is a usage error.
  if (args.length === 0 || args[0] !== 'init') {
    process.stderr.write(`checktest: expected 'init'\n\n${MUTATION_SANDBOX_USAGE}\n`);
    return 1;
  }
  let parsed: MutationSandboxCliArgs;
  try {
    parsed = parseMutationSandboxArgs(args.slice(1));
  } catch (error) {
    if (error instanceof MutationSandboxHelp) {
      process.stdout.write(`${MUTATION_SANDBOX_USAGE}\n`);
      return 0;
    }
    if (error instanceof MutationSandboxUsageError) {
      process.stderr.write(`checktest: ${error.message}\n\n${MUTATION_SANDBOX_USAGE}\n`);
      return 1;
    }
    throw error;
  }

  try {
    const result = initMutationSandbox({ dir: parsed.dir !== undefined ? resolveSandboxDir(parsed.dir) : undefined });

    if (parsed.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            kind: 'mutation-sandbox',
            schemaVersion: '0.5',
            dir: result.dir,
            sandboxDir: result.sandboxDir,
            configPath: result.configPath,
            gitignore: {
              path: result.gitignore.path,
              action: result.gitignore.action,
              requiredLine: result.gitignore.requiredLine,
            },
            strykerCommand: result.strykerCommand,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      const lines: string[] = [];
      lines.push('checktest mutation-sandbox init');
      lines.push(`Directory: ${result.dir}`);
      lines.push(`Sandbox:   ${result.sandboxDir}`);
      lines.push(`Config:    ${result.configPath}`);
      lines.push(`Gitignore: ${result.gitignore.path} (${result.gitignore.action})`);
      if (result.gitignore.action === 'foreign-print') {
        lines.push('Required .gitignore line (add it yourself):');
        lines.push(`  ${result.gitignore.requiredLine}`);
        lines.push('CheckTest never runs Stryker; this only prepares the safe working area.');
      }
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`checktest: ${(error as Error).message}\n`);
    return 1;
  }
}

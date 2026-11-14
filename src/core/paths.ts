import { normalize, resolve } from 'path';

/** Normalize a path to an absolute, platform-normalized form without trailing slashes. */
export function normalizePath(p: string): string {
  const resolved = resolve(p);
  const normalized = normalize(resolved);
  return normalized.replace(/[\\/]+$/, '');
}

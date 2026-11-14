/**
 * Pure coverage-line math shared by the coverage provider and the adapters.
 *
 * Zero dependencies: this module imports nothing, so any layer (core, adapter,
 * provider, rule) may use it without creating an import cycle (ADR-012).
 */

/**
 * Count the covered lines in a raw coverage-report value.
 *
 * Semantics are identical to the historical `countCoveredLines` in
 * `src/providers/coverage.ts`:
 * - non-array → 0
 * - array containing `null` (Istanbul hit-map) → count of entries equal to 1
 * - array with any non-number, non-null entry → 0
 * - empty array → 0
 * - numeric array whose max > 1 (c8 `coveredLines`) → its length
 * - otherwise (dense 0/1 array) → count of entries equal to 1
 */
export function lineCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  if (value.some((x) => x === null)) {
    return value.filter((x) => x === 1).length;
  }
  if (!value.every((x) => typeof x === 'number')) return 0;
  const nums = value as number[];
  if (nums.length === 0) return 0;
  if (Math.max(...nums) > 1) {
    return nums.length;
  }
  return nums.filter((x) => x === 1).length;
}

/**
 * Coerce a raw coverage-report value into a set of line numbers.
 *
 * A `number[]` becomes a `Set` of its members (duplicates collapse); anything
 * else — including Istanbul hit-maps with `null` entries — is `null`.
 */
export function toLineSet(value: unknown): Set<number> | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((x) => typeof x === 'number')) return null;
  return new Set(value as number[]);
}

/**
 * Count the members of `lines` that fall within the inclusive span
 * `[start, end]`. A `null` set (no usable line list) counts as 0.
 */
export function intersectLines(lines: Set<number> | null, start: number, end: number): number {
  if (lines === null) return 0;
  let count = 0;
  for (const line of lines) {
    if (line >= start && line <= end) count += 1;
  }
  return count;
}

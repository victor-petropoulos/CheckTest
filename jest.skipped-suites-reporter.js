/**
 * Jest reporter — explicit skipped-suite manifest (D12).
 *
 * Corpus suites skip whole suites when the machine-local validation/ manifest is
 * absent (validation/ is gitignored; a fresh checkout has no corpus reports).
 * Jest's own summary collapses that to "1 skipped", which hides WHICH suites and
 * WHY. This reporter re-derives the skipped suites from the real runtime results
 * and prints them, so CI observers see the skips.
 *
 * Suite names come from jest's AggregatedResult (never hard-coded). The reason
 * reuses each skipped test's own title; titles matching the corpus skip
 * convention are normalized to the canonical D12 reason.
 */

const path = require('path');

const MANIFEST_MISSING_REASON = 'validation corpus unavailable';

function reasonFor(title) {
  return /manifest missing on this checkout/.test(title) ? `${MANIFEST_MISSING_REASON} (${title})` : title;
}

function formatSkippedSuites(results) {
  const root = process.cwd();
  const lines = [];
  let count = 0;
  for (const suite of results.testResults) {
    // Runtime TestResult exposes the per-test assertions as `testResults`
    // (formatTestResults maps it to `assertionResults` only when serializing).
    const skipped = suite.testResults.filter(
      (assertion) => assertion.status === 'pending' || assertion.status === 'todo',
    );
    if (skipped.length === 0) continue;
    count += 1;
    const rel = path.relative(root, suite.testFilePath || '') || suite.testFilePath;
    const shown = rel.startsWith('..') ? suite.testFilePath : rel;
    const reasons = skipped.map((assertion) => reasonFor(assertion.title)).join('; ');
    const wholeSuite = suite.skipped ? ' [whole suite skipped]' : '';
    lines.push(`  ${shown} — ${reasons}${wholeSuite}`);
  }
  return [`SKIPPED SUITES: ${count}`, ...lines].join('\n') + '\n';
}

class SkippedSuitesReporter {
  onRunComplete(_contexts, results) {
    process.stderr.write(formatSkippedSuites(results));
  }
}

module.exports = SkippedSuitesReporter;
module.exports.formatSkippedSuites = formatSkippedSuites;

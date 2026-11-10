import { expect, it } from '@jest/globals';

// Case 18 — no tests: the file declares zero `it`/`test` sites.
//
// Collector result: SUCCESS, COMPLETE, tests: [] — zero per-test scopes,
// hence no verdict → CLI exit 2 (UD-8 single "no verdict" bucket). analysisStatus
// stays SUCCESS and ruleResults stays empty: NOT an analysis failure, no
// synthetic rule finding.
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked
// (tsconfig.json exclude).

const subject = 'a file that declares no test';

export { subject };

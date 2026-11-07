import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AnalysisStatus, AnalysisOutput, CapabilityStatus, Completeness, TestType } from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceRecord, Provenance } from '../../src/core/evidence';
import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { EVIDENCE_ASSERTION_COUNT } from '../../src/adapters/typescript/support';
import { regexAssertionCount } from '../../src/adapters/typescript/regex-assertion-count';

/** Fixtures live outside the repo so a malformed one never reaches `tsc`. */
const tempDirs: string[] = [];

function writeFixture(source: string, name = 'sample.ts'): string {
  const dir = mkdtempSync(join(tmpdir(), 'checktest-fixture-'));
  tempDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function assertionCount(output: AnalysisOutput): EvidenceRecord {
  return output.evidence[EVIDENCE_ASSERTION_COUNT];
}

const JEST_IMPORT = "import { expect, it } from '@jest/globals';\n";

/** One real assertion plus one written inside a comment (fixture 13 shape). */
const COMMENT_SOURCE = `${JEST_IMPORT}
// expect(1).toBe(1) — documented example, never executed
it('counts only real assertions', () => {
  expect(1).toBe(1);
});
`;

describe('collectAnalysis — supported framework', () => {
  it('reports SUCCESS / COMPLETE / KNOWN with at least one assertion', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('works', () => { expect(1).toBe(1); });\n`),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(record.value as number).toBeGreaterThanOrEqual(1);
    expect(record.provenance).toBe(Provenance.DIRECT);
    expect(record.scope).toBe('test-body');
    expect(record.coverage.supported_frameworks).toEqual(['jest', 'vitest']);
    expect(output.subject.language).toBe('typescript');
    expect(output.subject.framework).toBe('jest');
    expect(output.capabilities.assertion_forms).toBe(CapabilityStatus.AVAILABLE);
  });

  it('counts every recognized form in a straight-line body', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it('many', () => {
  expect(1).toBe(1);
  expect([1]).toEqual([1]);
  expect('x').toMatchSnapshot();
  expect(1).toBeTruthy();
});
`,
      ),
      TestType.UNIT,
    );
    expect(assertionCount(output).value).toBe(4);
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
  });

  it('counts an awaited rejects.toThrow as established', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it('async', async () => { await expect(Promise.reject(new Error('x'))).rejects.toThrow(); });\n`,
      ),
      TestType.UNIT,
    );
    expect(assertionCount(output).value).toBe(1);
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
  });

  it('reports a completed empty scan as 0 / KNOWN (zero is a finding, not a gap)', () => {
    const output = collectAnalysis(writeFixture(`${JEST_IMPORT}it('empty', () => {});\n`), TestType.UNIT);
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
    expect(assertionCount(output).value).toBe(0);
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
    expect(assertionCount(output).reason).toBeUndefined();
  });

  it('does not count expect() written in a comment', () => {
    const output = collectAnalysis(writeFixture(COMMENT_SOURCE), TestType.UNIT);
    expect(assertionCount(output).value).toBe(1);
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
  });

  it('never records a classification source other than explicit/default', () => {
    const explicit = collectAnalysis(writeFixture(`${JEST_IMPORT}it('a', () => {});`), TestType.UNIT);
    const defaulted = collectAnalysis(writeFixture(`${JEST_IMPORT}it('b', () => {});`));
    expect(explicit.analysis.test_type.source).toBe('EXPLICIT');
    expect(defaulted.analysis.test_type.value).toBe(TestType.UNKNOWN);
    expect(defaulted.analysis.test_type.source).toBe('DEFAULT');
  });

  it('is deterministic across runs on the same input', () => {
    const file = writeFixture(`${JEST_IMPORT}it('stable', () => { expect(1).toBe(1); });`);
    const first = JSON.stringify(collectAnalysis(file, TestType.UNIT));
    const second = JSON.stringify(collectAnalysis(file, TestType.UNIT));
    expect(first).toBe(second);
  });
});

describe('collectAnalysis — unsupported framework', () => {
  it('reports SUCCESS for a vitest test', () => {
    const output = collectAnalysis(
      writeFixture("import { expect, it } from 'vitest';\nit('x', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
    expect(output.subject.framework).toBe('vitest');
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
    expect(assertionCount(output).value).toBe(1);
  });

  it('derives jest from a bare-global declaration plus a bare expect() call (P1.3)', () => {
    const output = collectAnalysis(writeFixture('it("x", () => { expect(1).toBe(1); });\n'), TestType.UNIT);
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(output.subject.framework).toBe('jest');
    // The framework is DERIVED, not observed: the capability says so, and the
    // evidence reason names the inference (docs/limitations.md §4).
    expect(output.capabilities.framework_detection).toBe(CapabilityStatus.PARTIAL);
    expect(assertionCount(output).reason).toContain('derived from bare-global');
  });

  it('does not assume jest from a bare declaration without a bare expect() call', () => {
    const output = collectAnalysis(
      writeFixture('it("x", () => { request(app).get("/").expect(200); });\n'),
      TestType.UNIT,
    );
    expect(output.analysis.status).toBe(AnalysisStatus.UNSUPPORTED);
    expect(output.subject.framework).toBe('unknown');
  });

  it('reports UNSUPPORTED for a mixed jest+vitest file, never first-wins', () => {
    const output = collectAnalysis(
      writeFixture(
        "import { expect, it } from '@jest/globals';\nimport { vi } from 'vitest';\nit('x', () => { expect(1).toBe(1); vi.fn(); });\n",
      ),
      TestType.UNIT,
    );
    expect(output.analysis.status).toBe(AnalysisStatus.UNSUPPORTED);
    expect(output.analysis.completeness).toBe(Completeness.NOT_APPLICABLE);
    // 'mixed' is published on the subject so the report names WHY the file is
    // unsupported, instead of silently picking one framework's semantics.
    expect(output.subject.framework).toBe('mixed');
    expect(assertionCount(output).availability).toBe(Availability.UNKNOWN);
    expect(assertionCount(output).value).toBeUndefined();
    expect(assertionCount(output).reason).toContain("framework 'mixed' is outside the supported framework list");
  });
});

describe('collectAnalysis — collector failure', () => {
  it('reports FAILED and preserves parse diagnostics', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('broken', () => { const x = ; });\n`, 'broken.ts'),
      TestType.UNIT,
    );
    expect(output.analysis.status).toBe(AnalysisStatus.FAILED);
    // A failed scan is never COMPLETE (SPEC:425).
    expect(output.analysis.completeness).toBe(Completeness.INCOMPLETE);
    expect(assertionCount(output).availability).toBe(Availability.UNKNOWN);
    expect(assertionCount(output).value).toBeUndefined();
    expect(assertionCount(output).reason).toContain('parse diagnostics');
    expect(assertionCount(output).reason).toMatch(/TS\d+/);
  });

  it('reports FAILED when the file cannot be read', () => {
    const output = collectAnalysis(join(tmpdir(), 'checktest-does-not-exist-12345.ts'), TestType.UNIT);
    expect(output.analysis.status).toBe(AnalysisStatus.FAILED);
    expect(assertionCount(output).reason).toContain('unable to read test file');
  });
});

describe('collectAnalysis — unclassifiable constructs', () => {
  it('reports a computed matcher as PARTIAL coverage and UNKNOWN value', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('computed', () => { const m = 'toBe'; expect(1)[m](); });\n`),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(output.analysis.completeness).toBe(Completeness.INCOMPLETE);
    expect(record.reason).toContain('computed matcher');
  });

  it('reports an unsupported assertion API as INCOMPLETE with a reason', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('chai', () => { assert.equal(1, 1); });\n`),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(output.analysis.completeness).toBe(Completeness.INCOMPLETE);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('not a supported assertion form');
  });

  it('records an unresolvable custom assertion helper instead of dropping it', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}function expectValidUser(id: string) { return id.length > 0; }\nit('helper', () => { expectValidUser('u1'); });\n`,
      ),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(output.analysis.completeness).toBe(Completeness.INCOMPLETE);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('custom assertion helper');
    expect(record.reason).toContain('expectValidUser');
  });

  it('records an unsupported expect matcher rather than ignoring it', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('nope', () => { expect(1).toBeGreaterThan(0); });\n`),
      TestType.UNIT,
    );
    expect(assertionCount(output).availability).toBe(Availability.UNKNOWN);
    expect(assertionCount(output).reason).toContain('not one of the supported assertion forms');
  });
});

describe('collectAnalysis — executability (A7)', () => {
  it('marks an assertion after an unconditional return as unestablished', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('after return', () => { return; expect(1).toBe(1); });\n`),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.value).toBe(0);
    // The scan itself completed: recognition completeness stays COMPLETE.
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
    expect(record.reason).toContain('after an unconditional return/throw');
  });

  it('does not treat a conditional return as a halt', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it('conditional', (bump: boolean) => { if (bump) { return; } expect(1).toBe(1); });\n`,
      ),
      TestType.UNIT,
    );
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
    expect(assertionCount(output).value).toBe(1);
  });

  it('marks an assertion inside a callback as unestablished', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it('callback', (done) => { setTimeout(() => { expect(1).toBe(1); done(); }, 1); });\n`,
      ),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('inside a callback');
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
  });

  it('counts only the established assertions when the body mixes both', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it('mixed', (done) => {
  expect(1).toBe(1);
  setTimeout(() => { expect(2).toBe(2); done(); }, 1);
});
`,
      ),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.value).toBe(1);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('1 of 2 recognized assertion(s)');
  });

  it('ignores assertions outside test bodies (scope is test-body only)', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}expect(1).toBe(1);\nit('none', () => {});\n`),
      TestType.UNIT,
    );
    expect(assertionCount(output).value).toBe(0);
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
  });

  it('marks an assertion inside a nested block as unestablished (straight-line rule 3)', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it('nested', (flag: boolean) => {\n  if (flag) {\n    expect(1).toBe(1);\n  }\n});\n`,
      ),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    // Recognized but NOT established: a conditional block may or may not run.
    expect(record.value).toBe(0);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain('nested block');
    expect(record.reason).toContain('unestablished executability');
    // Recognition itself completed — the construct was classified, not missed.
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
  });
});

describe('collectAnalysis — test declaration gaps (F)', () => {
  it('reports each/skip/todo declarations: PARTIAL coverage, INCOMPLETE analysis', () => {
    const output = collectAnalysis(
      writeFixture(
        `${JEST_IMPORT}it.each([[1, 2]])('adds %i', (a: number, b: number) => {\n  expect(a + b).toBe(b);\n});\nit.skip('skipped', () => {\n  expect(1).toBe(1);\n});\nit.todo('pending');\n`,
      ),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    // Assertions inside each/skip bodies are recognized but their execution
    // frequency cannot be established statically -> unestablished, value 0.
    expect(record.value).toBe(0);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain('unestablished executability');
    // No declaration is silently omitted: all three are counted and named.
    expect(record.reason).toContain('3 test declaration(s) recognized, 3 not fully supported');
    expect(record.reason).toContain("'it.each' is not a supported test declaration form");
    expect(record.reason).toContain("'it.skip' is not a supported test declaration form");
    expect(record.reason).toContain("'it.todo' declares no executable test body");
    // A capability gap degrades BOTH dimensions, separately (SPEC:366).
    expect(output.analysis.completeness).toBe(Completeness.INCOMPLETE);
    expect(output.capabilities.assertion_forms).toBe(CapabilityStatus.PARTIAL);
  });

  it('a todo-only file is still COMPLETE: declaration-only forms cost no coverage, but are reported', () => {
    const output = collectAnalysis(writeFixture(`${JEST_IMPORT}it.todo('only a todo');\n`), TestType.UNIT);
    const record = assertionCount(output);

    // `it.todo` has NO executable body, so nothing could hide in it — the scan
    // is complete. The pending declaration is still reported, never dropped.
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
    expect(record.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(record.value).toBe(0);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.reason).toContain('1 test declaration(s) recognized, 1 not fully supported');
    expect(record.reason).toContain("'it.todo' declares no executable test body");
  });
});

describe('collectAnalysis — per-test records (plan task 1)', () => {
  const TWO_ASSERTED = `${JEST_IMPORT}it('first', () => { expect(1).toBe(1); });\nit('second', () => { expect(2).toBe(2); });\n`;
  const EMPTY_AND_ASSERTED = `${JEST_IMPORT}it('empty', () => {});\nit('asserted', () => { expect(1).toBe(1); });\n`;

  it('emits one record per declaration: two asserted tests -> values [1, 1]', () => {
    const output = collectAnalysis(writeFixture(TWO_ASSERTED), TestType.UNIT);
    expect(output.tests).toHaveLength(2);
    expect(output.tests!.map((t) => t.evidence[EVIDENCE_ASSERTION_COUNT].value)).toEqual([1, 1]);
  });

  it('REGRESSION D1: [empty, asserted] gives per-test values [0, 1] while the file-level record stays an aggregate of 1', () => {
    const output = collectAnalysis(writeFixture(EMPTY_AND_ASSERTED), TestType.UNIT);
    // Pre-fix probe produced only `value=1, result=PASS` at file level: with a
    // flat summed findings array there is no per-test layer to assert against.
    expect(output.tests).toHaveLength(2);
    expect(output.tests!.map((t) => t.evidence[EVIDENCE_ASSERTION_COUNT].value)).toEqual([0, 1]);
    // The file-level record keeps its exact shape: one assertion in the file.
    expect(assertionCount(output).value).toBe(1);
    expect(assertionCount(output).availability).toBe(Availability.KNOWN);
    expect(output.analysis.completeness).toBe(Completeness.COMPLETE);
    // The empty test carries its OWN availability/coverage — not the file's.
    const empty = output.tests![0];
    expect(empty.test.name).toBe('empty');
    expect(empty.evidence[EVIDENCE_ASSERTION_COUNT].availability).toBe(Availability.KNOWN);
    expect(empty.evidence[EVIDENCE_ASSERTION_COUNT].coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(empty.declaration_gap).toBeNull();
  });

  it('locates a describe-nested test with its own identity', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}describe('group', () => {\n  it('nested', () => { expect(1).toBe(1); });\n});\n`),
      TestType.UNIT,
    );
    expect(output.tests).toHaveLength(1);
    const nested = output.tests![0];
    expect(nested.test.name).toBe('nested');
    expect(nested.test.line).toBe(3);
    expect(nested.test.declaration).toBe('it');
    expect(nested.declaration_gap).toBeNull();
    expect(nested.evidence[EVIDENCE_ASSERTION_COUNT].value).toBe(1);
  });

  it('gives it.todo its own record: declaration_gap set, no fabricated zero-value verdict basis', () => {
    const output = collectAnalysis(
      writeFixture(`${JEST_IMPORT}it('real', () => { expect(1).toBe(1); });\nit.todo('pending');\n`),
      TestType.UNIT,
    );
    expect(output.tests).toHaveLength(2);
    const todo = output.tests![1];
    expect(todo.test.name).toBe('pending');
    expect(todo.declaration_gap).toContain("'it.todo' declares no executable test body");
    const record = todo.evidence[EVIDENCE_ASSERTION_COUNT];
    // No body was scanned: value stays absent, availability UNKNOWN — this
    // record can never be read as a zero-assertion FAIL.
    expect(record.value).toBeUndefined();
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain("'it.todo' declares no executable test body");
    // The sibling test's record is untouched by the gap.
    expect(output.tests![0].evidence[EVIDENCE_ASSERTION_COUNT].value).toBe(1);
    expect(output.tests![0].declaration_gap).toBeNull();
  });

  it('ids follow <file>#<declaration>@<line> and are stable across two runs', () => {
    const file = writeFixture(TWO_ASSERTED);
    const first = collectAnalysis(file, TestType.UNIT);
    const second = collectAnalysis(file, TestType.UNIT);
    expect(first.tests!.map((t) => t.test.id)).toEqual([`${file}#it@2`, `${file}#it@3`]);
    expect(first.tests!.map((t) => t.test.id)).toEqual(second.tests!.map((t) => t.test.id));
  });
});

describe('collectAnalysis — declaration boundary coverage (WP1.3)', () => {
  const JEST = "import { expect, it } from '@jest/globals';\n";

  function perTest(output: AnalysisOutput) {
    return output.tests ?? [];
  }

  it('it.each gets its own record: value absent, availability UNKNOWN, never FAIL', () => {
    const output = collectAnalysis(
      writeFixture(
        JEST + "it.each([[1, 2]])('adds %i', (a: number, b: number) => {\n" + '  expect(a + b).toBe(b);\n' + '});\n',
      ),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain("'it.each' is not a supported test declaration form");

    const each = perTest(output).find((t) => t.test.declaration === 'it.each');
    expect(each).toBeDefined();
    const eachRecord = each!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(eachRecord.value).toBeUndefined();
    expect(eachRecord.availability).toBe(Availability.UNKNOWN);
    expect(each!.declaration_gap).toContain("'it.each'");
  });

  it('it.skip gets its own record: value absent, availability UNKNOWN, never FAIL', () => {
    const output = collectAnalysis(
      writeFixture(JEST + "it.skip('skipped', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain("'it.skip' is not a supported test declaration form");

    const skip = perTest(output).find((t) => t.test.declaration === 'it.skip');
    expect(skip).toBeDefined();
    const skipRecord = skip!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(skipRecord.value).toBeUndefined();
    expect(skipRecord.availability).toBe(Availability.UNKNOWN);
    expect(skip!.declaration_gap).toContain("'it.skip'");
  });

  it('it.only gets its own record: value absent, availability UNKNOWN, never FAIL', () => {
    const output = collectAnalysis(
      writeFixture(JEST + "it.only('focused', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain("'it.only' is not a supported test declaration form");

    const only = perTest(output).find((t) => t.test.declaration === 'it.only');
    expect(only).toBeDefined();
    const onlyRecord = only!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(onlyRecord.value).toBeUndefined();
    expect(onlyRecord.availability).toBe(Availability.UNKNOWN);
    expect(only!.declaration_gap).toContain("'it.only'");
  });

  it('a conditional declaration (cond ? it.skip : it) is not silently dropped', () => {
    // WP3.4 defect 1 (apollo-server index.test.ts:901). The call's callee is a
    // ConditionalExpression; classifyTestDeclaration must REPORT it, not
    // return null -> no site -> nonePresent -> COMPLETE / value 0 / KNOWN,
    // which reads as "no test declared here" (category 5).
    const output = collectAnalysis(
      writeFixture(JEST + "(process.env.X ? it.skip : it)('maybe', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain('conditional');
    // The gap reason carries the whole conditional syntax, truncated to 60
    // chars — `(process.env.X ? it.skip : it)` is inside it.
    expect(record.reason).toContain('it.skip');

    const tests = perTest(output);
    expect(tests).toHaveLength(1);
    const site = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(site.value).toBeUndefined();
    expect(site.availability).toBe(Availability.UNKNOWN);
    expect(tests[0].declaration_gap).toContain('conditional');
    expect(tests[0].declaration_gap).toContain('statically');
  });

  it('a one-root conditional declaration (c ? it : helper) is reported with a gap', () => {
    // WP3.4 remediation: a ternary whose only one branch resolves to a test
    // root still carries partial evidence (one candidate root known); it must be
    // REPORTED with the conditional gap, not silently dropped.
    const output = collectAnalysis(
      writeFixture(JEST + "(c ? it : helper)('x', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(output);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain('conditional');
    const tests = perTest(output);
    expect(tests).toHaveLength(1);
    const site = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(site.value).toBeUndefined();
    expect(site.availability).toBe(Availability.UNKNOWN);
    expect(tests[0].declaration_gap).toContain('conditional');
    expect(tests[0].declaration_gap).toContain('statically');
  });

  it('a one-root binary declaration (flag && it.skip) is reported with a gap', () => {
    // WP3.4 remediation: a &&/|| callee whose one operand resolves to a test
    // root is reported with the conditional gap.
    const output = collectAnalysis(
      writeFixture(JEST + "(flag && it.skip)('y', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(output);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain('conditional');
    const tests = perTest(output);
    expect(tests).toHaveLength(1);
    const site = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(site.value).toBeUndefined();
    expect(site.availability).toBe(Availability.UNKNOWN);
    expect(tests[0].declaration_gap).toContain('conditional');
    expect(tests[0].declaration_gap).toContain('statically');
  });

  it('neither-root compound callee stays a silent drop (no fabricated declaration)', () => {
    // WP3.4 remediation decision: neither branch carries test-root evidence, so
    // there is nothing static to report as a declaration. Keeping the drop yields
    // analysisStatus SUCCESS + exit-2 (no verdict) + empty ruleResults — no false
    // FAIL and no fabricated root (docs/Development_Roadmap.md:957-959 floor).
    const output = collectAnalysis(
      writeFixture(JEST + "(c ? helper : other)('z', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    expect(perTest(output)).toHaveLength(0);
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
  });

  it('an aliased declaration (const t = it) is detected and reported with a gap', () => {
    // WP3.4 defect 2 (limitations.md §12). `const t = it` is a verified
    // in-file alias of a declaration root; the call `t('dynamic', fn)` is a
    // test declaration detected through the alias, reported with a gap — not
    // the old silent drop that produced COMPLETE / 0 / KNOWN and an
    // unjustified FAIL from CT-INT-001.
    const output = collectAnalysis(
      writeFixture(JEST + 'const t = it;\n' + "t('dynamic', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(output);

    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);

    const dynamic = perTest(output).find((t) => t.test.name === 'dynamic');
    expect(dynamic).toBeDefined();
    const dynRecord = dynamic!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(dynRecord.value).toBeUndefined();
    expect(dynRecord.availability).toBe(Availability.UNKNOWN);
    expect(dynamic!.declaration_gap).toContain('alias');
  });

  it('a let-bound alias (let t = it) is detected identically; a no-initializer reassignment is not', () => {
    // WP3.4 fix round 1 — critic finding: `let t = it` HAS a declaration-time
    // initializer, the same static in-file evidence as `const`, so it is
    // DETECTED as an 'aliased' gap (docs §12 amended: `const` and `let` both
    // count). The undetected form is reassignment WITHOUT an initializer
    // (`let t; t = test`), asserted second — it keeps the old silent path.
    const withInit = collectAnalysis(
      writeFixture(JEST + 'let t = it;\n' + "t('dynamic-let', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    const record = assertionCount(withInit);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    const dynLet = perTest(withInit).find((t) => t.test.name === 'dynamic-let');
    expect(dynLet).toBeDefined();
    expect(dynLet!.evidence[EVIDENCE_ASSERTION_COUNT].value).toBeUndefined();
    expect(dynLet!.evidence[EVIDENCE_ASSERTION_COUNT].availability).toBe(Availability.UNKNOWN);
    expect(dynLet!.declaration_gap).toContain('alias');

    // Reassignment with no initializer: no static evidence at the declaration,
    // so NO alias is found — documented boundary, not a bug (§12).
    const reassigned = collectAnalysis(
      writeFixture(JEST + 'let t;\n' + 't = it;\n' + "t('dynamic-reassign', () => { expect(1).toBe(1); });\n"),
      TestType.UNIT,
    );
    expect(assertionCount(reassigned).coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(perTest(reassigned)).toEqual([]);
  });

  it('sibling isolation: a pending declaration leaves a neighbouring test untouched', () => {
    const output = collectAnalysis(
      writeFixture(
        JEST + "it('real', () => { expect(1).toBe(1); });\n" + "it.skip('pending', () => { expect(2).toBe(2); });\n",
      ),
      TestType.UNIT,
    );
    const tests = perTest(output);
    expect(tests).toHaveLength(2);

    const real = tests.find((t) => t.test.name === 'real');
    const pending = tests.find((t) => t.test.name === 'pending');
    expect(real).toBeDefined();
    expect(pending).toBeDefined();

    // The neighbouring asserted test keeps its own value and availability:
    // the pending declaration's gap never contaminates it.
    const realRecord = real!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(realRecord.value).toBe(1);
    expect(realRecord.availability).toBe(Availability.KNOWN);
    expect(real!.declaration_gap).toBeNull();

    // The pending declaration keeps its own gap record.
    expect(pending!.declaration_gap).toContain("'it.skip'");
    const pendingRecord = pending!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(pendingRecord.value).toBeUndefined();
    expect(pendingRecord.availability).toBe(Availability.UNKNOWN);
  });
});

describe('regex stub provider (M3)', () => {
  it('disagrees with the AST collector on a commented assertion', () => {
    const file = writeFixture(COMMENT_SOURCE);
    const ast = assertionCount(collectAnalysis(file, TestType.UNIT));
    const stub = regexAssertionCount(COMMENT_SOURCE);

    expect(ast.value).toBe(1);
    expect(stub.value).toBe(2);
    expect(stub.provenance).toBe(Provenance.DERIVED);
    expect(stub.type).toBe(EVIDENCE_ASSERTION_COUNT);
    expect(stub.source).not.toBe(ast.source);
    // A text scan cannot establish executability — it must not claim KNOWN.
    expect(stub.availability).toBe(Availability.UNKNOWN);
    expect(stub.coverage.status).toBe(CollectionStatus.PARTIAL);
  });

  it('agrees when no assertion is hidden in a comment', () => {
    const source = `${JEST_IMPORT}it('x', () => { expect(1).toBe(1); });\n`;
    const file = writeFixture(source);
    expect(assertionCount(collectAnalysis(file, TestType.UNIT)).value).toBe(regexAssertionCount(source).value);
  });

  it('reports zero for a source with no expect call', () => {
    expect(regexAssertionCount('const x = 1;').value).toBe(0);
  });
});

describe('evidence reason invariant (WP2.4 bullet 5)', () => {
  it('every non-KNOWN evidence record carries a reason, file-level and per-declaration', () => {
    const source =
      `${JEST_IMPORT}` +
      `it('established', () => { expect(1).toBe(1); })\n` +
      `it.todo('pending')\n` +
      `it('callback', (done) => { setTimeout(() => { expect(1).toBe(1); done(); }, 1); })\n`;
    const output = collectAnalysis(writeFixture(source), TestType.UNIT);

    const records: EvidenceRecord[] = [assertionCount(output)];
    for (const test of output.tests ?? []) {
      records.push(test.evidence[EVIDENCE_ASSERTION_COUNT]);
    }

    let nonKnown = 0;
    for (const record of records) {
      if (record.availability !== Availability.KNOWN) {
        nonKnown++;
        expect(record.reason).toBeDefined();
        expect(record.reason!.length).toBeGreaterThan(0);
      }
    }
    // Non-vacuous: this fixture deliberately emits non-KNOWN records.
    expect(nonKnown).toBeGreaterThan(0);
  });
});

describe('Phase 3 Unit A — per-declaration additive evidence', () => {
  const collectFile = (src: string) => collectAnalysis(writeFixture(src), TestType.UNIT);

  it('unestablished present with REASON_CALLBACK on callback fixture-equivalent', () => {
    const output = collectFile(
      `${JEST_IMPORT}it('cb', (done) => { setTimeout(() => { expect(1 + 1).toBe(2); done(); }, 1); });\n`,
    );
    const tests = output.tests ?? [];
    expect(tests).toHaveLength(1);
    const rec = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.unestablished_assertions).toEqual({
      count: 1,
      reasons: ['assertion is inside a callback; callback execution cannot be established statically'],
    });
    expect(rec.unclassified_constructs).toBeUndefined();
  });

  it('unestablished present with REASON_AFTER_HALT on after-return body', () => {
    const output = collectFile(`${JEST_IMPORT}it('r', () => { return; expect(1 + 1).toBe(2); });\n`);
    const tests = output.tests ?? [];
    const rec = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.unestablished_assertions).toEqual({
      count: 1,
      reasons: ['assertion appears after an unconditional return/throw; execution cannot be established statically'],
    });
    expect(rec.unclassified_constructs).toBeUndefined();
  });

  it('unclassified present with REASON computed matcher on partial collection body', () => {
    const output = collectFile(
      `${JEST_IMPORT}it('c', () => { const matcher = 'toBe'; expect(1 + 1)[matcher](2); });\n`,
    );
    const tests = output.tests ?? [];
    const rec = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.unclassified_constructs).toEqual({
      count: 1,
      reasons: ['computed matcher cannot be resolved statically'],
    });
    expect(rec.unestablished_assertions).toBeUndefined();
  });

  it('disabled/absent when no unestablished and no unclassified', () => {
    const output = collectFile(`${JEST_IMPORT}it('straight', () => { expect(1 + 1).toBe(2); });\n`);
    const tests = output.tests ?? [];
    const rec = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.unestablished_assertions).toBeUndefined();
    expect(rec.unclassified_constructs).toBeUndefined();
  });

  it('existing assertion_count value unchanged on after-return fixture', () => {
    const output = collectFile(`${JEST_IMPORT}it('r', () => { return; expect(1 + 1).toBe(2); });\n`);
    const rec = (output.tests ?? [])[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.value).toBe(0);
    expect(rec.availability).toBe(Availability.UNKNOWN);
  });

  it('reason (nested block) uses exact value REASON_NESTED_BLOCK', () => {
    const output = collectFile(`${JEST_IMPORT}it('n', () => { if (true) { expect(1 + 1).toBe(2); } });\n`);
    const rec = (output.tests ?? [])[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.unestablished_assertions).toEqual({
      count: 1,
      reasons: [
        'assertion is inside a nested block (if/loop/try/switch); straight-line execution cannot be established statically',
      ],
    });
  });

  it('both fields distinct when one decl has unestablished and sibling has unclassified', () => {
    const output = collectFile(
      `${JEST_IMPORT}it('cb', () => { setTimeout(() => { expect(1 + 1).toBe(2); }, 1); });\n` +
        `it('c', () => { const m = 'toBe'; expect(1+1)[m](2); });\n`,
    );
    const tests = output.tests ?? [];
    expect(tests).toHaveLength(2);
    expect(tests[0].evidence[EVIDENCE_ASSERTION_COUNT].unestablished_assertions?.count).toBe(1);
    expect(tests[0].evidence[EVIDENCE_ASSERTION_COUNT].unclassified_constructs).toBeUndefined();
    expect(tests[1].evidence[EVIDENCE_ASSERTION_COUNT].unclassified_constructs?.count).toBe(1);
    expect(tests[1].evidence[EVIDENCE_ASSERTION_COUNT].unestablished_assertions).toBeUndefined();
  });

  it('unsupported namespace reports unclassified with exact reason', () => {
    const output = collectFile(`${JEST_IMPORT}it('b', () => { assert.equal(1,1); });\n`);
    if (output.analysis.status !== AnalysisStatus.SUCCESS) return;
    const tests = output.tests ?? [];
    expect(tests).toHaveLength(1);
    const rec = tests[0].evidence[EVIDENCE_ASSERTION_COUNT];
    expect(rec.unclassified_constructs).toEqual({
      count: 1,
      reasons: ["'assert' is not a supported assertion form"],
    });
  });
});

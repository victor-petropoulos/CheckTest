import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import { AnalysisStatus, ClassificationSource, Completeness, TestType } from '../../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceStrength, Provenance } from '../../../src/core/evidence';
import { collectAnalysis, type SubstrateProbe } from '../../../src/adapters/python/collector';

const FIXTURES = join(__dirname, 'fixtures');

function hasPositiveValue(value: unknown): boolean {
  if (typeof value === 'number') return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === 'object') return Object.keys(value as object).length > 0;
  return false;
}

describe('python adapter — collectAnalysis contract (Phase 8 C1)', () => {
  it('pytest assert → assertion_count KNOWN with value > 0', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    const record = output.evidence['assertion_count'];

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(typeof record.value).toBe('number');
    expect(record.value as number).toBeGreaterThan(0);
  });

  it('unittest self.assertEqual → assertion_count KNOWN with value > 0', () => {
    const output = collectAnalysis(join(FIXTURES, 'unittest_sample.py'));
    const record = output.evidence['assertion_count'];

    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.value as number).toBeGreaterThan(0);
  });

  it('coverage.py lcov → line_coverage KNOWN with value present', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: join(FIXTURES, 'coverage.lcov'),
    } as any);
    const record = output.evidence['line_coverage'];

    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.KNOWN);
    expect(hasPositiveValue(record.value)).toBe(true);
  });

  it('coverage.py json → line_coverage KNOWN with value present', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: join(FIXTURES, 'coverage.json'),
    } as any);
    const record = output.evidence['line_coverage'];

    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.KNOWN);
    expect(hasPositiveValue(record.value)).toBe(true);
  });

  it('no mutation tool → mutation_score UNKNOWN reason contains "no mutation report supplied"', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    const record = output.evidence['mutation_score'];

    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('no mutation report supplied');
  });

  it('hypothesis @given → assertion_count PARTIAL reason contains "unsupported-form"', () => {
    const output = collectAnalysis(join(FIXTURES, 'hypothesis_given.py'));
    const record = output.evidence['assertion_count'];

    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.reason).toContain('unsupported-form');
  });
});

describe('substrate fallback (C3 gap-close)', () => {
  it('unparseable coverage report → line_coverage UNKNOWN reason contains "unparseable-coverage-report"', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: join(FIXTURES, 'coverage_garbage.lcov'),
    } as any);
    const record = output.evidence['line_coverage'];

    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('unparseable-coverage-report');
  });
});

describe('D-20261112-5 rulings: declaredType + coverageReport forwarding', () => {
  it('declaredType UNIT → classifiedType UNIT with source EXPLICIT', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), { declaredType: TestType.UNIT });
    expect(output.subject.type).toBe(TestType.UNIT);
    expect(output.subject.type).toBe(TestType.UNIT);
    expect(output.analysis.test_type.value).toBe(TestType.UNIT);
    expect(output.analysis.test_type.source).toBe(ClassificationSource.EXPLICIT);
  });

  it('no declaredType → UNKNOWN / DEFAULT (unchanged default path)', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    expect(output.subject.type).toBe(TestType.UNKNOWN);
    expect(output.analysis.test_type.source).toBe(ClassificationSource.DEFAULT);
  });

  it('coverageReport forwarded → line_coverage KNOWN for lcov', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: join(FIXTURES, 'coverage.lcov'),
    });
    const record = output.evidence['line_coverage'];
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.value).toBeDefined();
  });
});

describe('Phase 9: coverageMap + perTestRun forwarding', () => {
  it('coverageMap forwarded: python collectAnalysis receives coverageMap option', () => {
    const fixturePy = join(FIXTURES, 'pytest_sample.py');
    const fixtureCov = join(FIXTURES, 'coverage.lcov');
    const analysis = collectAnalysis(fixturePy, {
      coverageReport: fixtureCov,
      coverageMap: [`${fixturePy}=production.py`],
      perTestRun: true,
    });
    expect(analysis.analysis.status).toBe(AnalysisStatus.SUCCESS);
  });
});

describe('per-declaration evidence (Phase 8 C5 completion)', () => {
  it('lcov supplied -> per-test line_coverage carries the declaration span intersection', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: join(FIXTURES, 'coverage.lcov'),
    });
    const scopes = output.tests ?? [];
    const byName = new Map(scopes.map((scope) => [scope.test.name, scope]));
    // pytest_sample.py: test_add spans lines 4-6, test_sub spans lines 9-10;
    // the lcov fixture covers [1,2,5,6,9] -> test_add intersects {5,6} (2),
    // test_sub intersects {9} (1).
    const add = byName.get('test_add');
    const sub = byName.get('test_sub');
    expect(add).toBeDefined();
    expect(sub).toBeDefined();
    expect(add!.evidence['line_coverage'].availability).toBe(Availability.KNOWN);
    expect(add!.evidence['line_coverage'].value).toBe(2);
    expect(add!.evidence['line_coverage'].coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(sub!.evidence['line_coverage'].availability).toBe(Availability.KNOWN);
    expect(sub!.evidence['line_coverage'].value).toBe(1);
  });

  it('no coverage report -> no per-test line_coverage record', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['line_coverage']).toBeUndefined();
    }
  });

  it('per-test mutation_score -> UNKNOWN with the canonical gap reason', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    for (const scope of output.tests ?? []) {
      const record = scope.evidence['mutation_score'];
      expect(record).toBeDefined();
      expect(record.availability).toBe(Availability.UNKNOWN);
      expect(record.reason).toContain('no mutation report supplied');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Upstream tree-sitter jest race (node-tree-sitter #181)
 * ------------------------------------------------------------------ */

/** The node shape the collector's walk touches (collector.ts StNode). */
interface FakeNode {
  type: string;
  startPosition: { row: number };
  endPosition: { row: number };
  text: string;
  childForFieldName(name: string): FakeNode | null;
  childCount: number;
  child(index: number): FakeNode | null;
  children?: FakeNode[];
}

/** Minimal tree-sitter node: only the members the walk reads are modelled. */
function fakeNode(spec: {
  type: string;
  text: string;
  row: number;
  endRow?: number;
  children?: FakeNode[];
  fields?: Record<string, FakeNode>;
}): FakeNode {
  const children = spec.children ?? [];
  return {
    type: spec.type,
    text: spec.text,
    startPosition: { row: spec.row },
    endPosition: { row: spec.endRow ?? spec.row },
    childForFieldName: (name: string) => spec.fields?.[name] ?? null,
    childCount: children.length,
    child: (index: number) => children[index] ?? null,
    children,
  };
}

/**
 * Module tree for `def test_a():\n    assert 1\n`: one function_definition
 * named test_a whose body holds one assert_statement.
 */
function fakeModuleTree(): FakeNode {
  const name = fakeNode({ type: 'identifier', text: 'test_a', row: 0 });
  const assertion = fakeNode({ type: 'assert_statement', text: 'assert 1', row: 1 });
  const body = fakeNode({ type: 'block', text: '    assert 1', row: 1, children: [assertion] });
  const fn = fakeNode({
    type: 'function_definition',
    text: 'def test_a():',
    row: 0,
    endRow: 1,
    children: [name, body],
    fields: { name, body },
  });
  return fakeNode({ type: 'module', text: '', row: 0, endRow: 1, children: [fn] });
}

/** Module tree for `def test_a():\n    foo.raises(Exception)\n` (native call form, non-pytest receiver). */
function fakeRaisesTree(): FakeNode {
  const name = fakeNode({ type: 'identifier', text: 'test_a', row: 0 });
  const obj = fakeNode({ type: 'identifier', text: 'foo', row: 1 });
  const attr = fakeNode({ type: 'identifier', text: 'raises', row: 1 });
  const fnAttr = fakeNode({
    type: 'attribute',
    text: 'foo.raises',
    row: 1,
    children: [obj, attr],
    fields: { object: obj, attribute: attr },
  });
  const call = fakeNode({
    type: 'call',
    text: 'foo.raises(Exception)',
    row: 1,
    children: [fnAttr],
    fields: { function: fnAttr },
  });
  const body = fakeNode({ type: 'block', text: '    foo.raises(Exception)', row: 1, children: [call] });
  const fn = fakeNode({
    type: 'function_definition',
    text: 'def test_a():',
    row: 0,
    endRow: 1,
    children: [name, body],
    fields: { name, body },
  });
  return fakeNode({ type: 'module', text: '', row: 0, endRow: 1, children: [fn] });
}

type FakeParser = new () => {
  setLanguage(language: unknown): void;
  parse(src: string): { rootNode: FakeNode | undefined };
};

/**
 * Fake tree-sitter module. The FIRST parser instance answers with an
 * undefined rootNode (the upstream jest race); the SECOND instance — the
 * fresh parser the collector retries with — parses normally. `alwaysUndefined`
 * makes every instance fail, which is the "no recovery" case.
 */
function fakeTreeSitter(alwaysUndefined: boolean): FakeParser {
  let created = 0;
  class FakeParserClass {
    private readonly index = created++;
    setLanguage(_language: unknown): void {
      /* the fake grammar is inert */
    }
    parse(_src: string): { rootNode: FakeNode | undefined } {
      if (alwaysUndefined || this.index === 0) return { rootNode: undefined };
      return { rootNode: fakeModuleTree() };
    }
  }
  return FakeParserClass;
}

/** Probe that resolves the fake tree-sitter modules and nothing else. */
function fakeProbe(parser: FakeParser, python3?: string): SubstrateProbe {
  return {
    require(id: string): unknown {
      if (id === 'tree-sitter') return parser;
      if (id === 'tree-sitter-python') return { name: 'fake-python' };
      throw new Error(`unexpected native module ${id}`);
    },
    python3,
  };
}

describe('native parse race (upstream node-tree-sitter #181)', () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'checktest-py-race-'));
    file = join(dir, 'race_sample.py');
    writeFileSync(file, 'def test_a():\n    assert 1\n', 'utf8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('undefined rootNode then a valid one -> the fresh-parser retry recovers, fallback untouched', () => {
    // The probe's python3 points nowhere: if the fallback were taken the run
    // would FAIL, so SUCCESS proves the native retry answered.
    const output = collectAnalysis(file, {
      substrateProbe: fakeProbe(fakeTreeSitter(false), 'python3-definitely-not-on-path'),
    });
    const record = output.evidence['assertion_count'];

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.value).toBe(1);
    expect(output.tests?.map((scope) => scope.test.name)).toEqual(['test_a']);
  });

  it('undefined rootNode on both parses -> the throw routes to the python3-ast fallback', () => {
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) });
    const record = output.evidence['assertion_count'];

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.value).toBe(1);
    expect(output.tests?.map((scope) => scope.test.name)).toEqual(['test_a']);
  });
});

describe('native substrate parity — non-pytest .raises (Phase 9 1.3 fix)', () => {
  it('tree-sitter path counts non-pytest .raises as UNSUPPORTED', () => {
    class AlwaysTreeParser {
      setLanguage(_language: unknown): void {}
      parse(_src: string): { rootNode: FakeNode | undefined } {
        return { rootNode: fakeRaisesTree() };
      }
    }
    const probe: SubstrateProbe = {
      require(id: string): unknown {
        if (id === 'tree-sitter') return AlwaysTreeParser;
        if (id === 'tree-sitter-python') return { name: 'fake-python' };
        throw new Error(`unexpected native module ${id}`);
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'py-raises-native-'));
    const file = join(dir, 'raises_sample.py');
    writeFileSync(file, 'def test_a():\n    foo.raises(Exception)\n', 'utf8');
    try {
      const output = collectAnalysis(file, { substrateProbe: probe } as any);
      expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
      expect(output.evidence['assertion_count'].value).toBe(1);
      expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
      for (const scope of output.tests ?? []) {
        expect(scope.evidence['assertion_count'].value).toBe(1);
        expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('python mapped production-file semantics (ADR-038, Phase 9 SP-D)', () => {
  it('mapped + perTestRun: subject line_coverage count and scoped per-declaration {0,1}', () => {
    const analyzed = join(FIXTURES, 'pytest_sample.py');
    const output = collectAnalysis(analyzed, {
      coverageReport: join(FIXTURES, 'mapped-production.json'),
      coverageMap: [`${analyzed}=/abs/production.py`],
      perTestRun: true,
    } as any);

    const subjectLc = output.evidence['line_coverage'];
    expect(subjectLc).toBeDefined();
    expect(subjectLc.availability).toBe(Availability.KNOWN);
    expect(subjectLc.value).toBe(2);
    expect(subjectLc.reason).toContain('mapped to /abs/production.py');

    const scopes = output.tests ?? [];
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      const decl = scope.evidence['line_coverage'];
      expect(decl).toBeDefined();
      expect(decl.availability).toBe(Availability.KNOWN);
      expect([0, 1]).toContain(decl.value);
      expect(decl.reason).toContain('coverage evidence from a run scoped to');
    }
  });

  it('mapped + perTestRun + missing production entry: subject UNKNOWN, exact reason', () => {
    const analyzed = join(FIXTURES, 'pytest_sample.py');
    const output = collectAnalysis(analyzed, {
      coverageReport: join(FIXTURES, 'mapped-production.json'),
      coverageMap: [`${analyzed}=/abs/missing-production.py`],
      perTestRun: true,
    } as any);

    const subjectLc = output.evidence['line_coverage'];
    expect(subjectLc).toBeDefined();
    expect(subjectLc.availability).toBe(Availability.UNKNOWN);
    expect(subjectLc.reason).toBe('no coverage data for /abs/missing-production.py');
  });

  it('mapped + NO perTestRun: unmapped semantic with attestation annotation', () => {
    const analyzed = join(FIXTURES, 'pytest_sample.py');
    const unmapped = collectAnalysis(analyzed, {
      coverageReport: join(FIXTURES, 'coverage.lcov'),
    } as any);
    const output = collectAnalysis(analyzed, {
      coverageReport: join(FIXTURES, 'coverage.lcov'),
      coverageMap: [`${analyzed}=/abs/production.py`],
    } as any);

    const subjectLc = output.evidence['line_coverage'];
    expect(subjectLc).toBeDefined();
    expect(subjectLc.availability).toBe(Availability.KNOWN);
    expect(subjectLc.value).toEqual(unmapped.evidence['line_coverage'].value);
    expect(subjectLc.reason).toContain(
      'coverage map supplied without --per-test-run attestation; mapped semantics not applied',
    );

    const byName = new Map((output.tests ?? []).map((scope) => [scope.test.name, scope]));
    const unmappedByName = new Map((unmapped.tests ?? []).map((scope) => [scope.test.name, scope]));
    expect(byName.get('test_add')!.evidence['line_coverage'].value).toBe(
      unmappedByName.get('test_add')!.evidence['line_coverage'].value,
    );
    expect(byName.get('test_sub')!.evidence['line_coverage'].value).toBe(
      unmappedByName.get('test_sub')!.evidence['line_coverage'].value,
    );
  });

  it('unmapped: byte-identical to existing fixture-driven expectations (regression guard)', () => {
    const analyzed = join(FIXTURES, 'pytest_sample.py');
    const output = collectAnalysis(analyzed, {
      coverageReport: join(FIXTURES, 'coverage.lcov'),
    } as any);
    const record = output.evidence['line_coverage'];

    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.value).toEqual([1, 2, 5, 6, 9]);

    const byName = new Map((output.tests ?? []).map((scope) => [scope.test.name, scope]));
    expect(byName.get('test_add')!.evidence['line_coverage'].value).toBe(2);
    expect(byName.get('test_sub')!.evidence['line_coverage'].value).toBe(1);
  });
});

describe('python coverage provenance/freshness (Phase 9 1.5, F4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-cov-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeReport(revision?: string): string {
    const p = join(dir, 'coverage.json');
    const body: Record<string, unknown> = {
      meta: revision !== undefined ? { version: '7.0', source_revision: revision } : { version: '7.0' },
      files: { 'pytest_sample.py': { executed_lines: [1, 2, 5, 6, 9] } },
    };
    writeFileSync(p, JSON.stringify(body), 'utf8');
    return p;
  }

  it('matching revision -> EXTERNAL, provider id, source_revision, KNOWN', () => {
    const report = writeReport('rev1');
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: report,
      analyzedRevision: 'rev1',
    } as any);
    const record = output.evidence['line_coverage'];
    expect(record).toBeDefined();
    expect(record.provenance).toBe(Provenance.EXTERNAL);
    expect(record.provider).toBe('coverage.py');
    expect(record.source_revision).toBe('rev1');
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(hasPositiveValue(record.value)).toBe(true);
  });

  it('mismatched revision -> UNKNOWN/UNAVAILABLE with mismatch reason', () => {
    const report = writeReport('rev1');
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: report,
      analyzedRevision: 'rev2',
    } as any);
    const record = output.evidence['line_coverage'];
    expect(record).toBeDefined();
    expect(record.provenance).toBe(Provenance.EXTERNAL);
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(record.reason).toContain('source revision mismatch: report rev1 != analyzed rev2');
  });

  it('report without revision + analyzedRevision -> keep_guard UNKNOWN/UNAVAILABLE', () => {
    const report = writeReport();
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: report,
      analyzedRevision: 'rev1',
    } as any);
    const record = output.evidence['line_coverage'];
    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(record.reason).toContain('report revision unknown; freshness cannot be established');
  });

  it('no analyzedRevision -> no freshness claim (KNOWN), preserves existing semantics', () => {
    const report = writeReport();
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: report,
    } as any);
    const record = output.evidence['line_coverage'];
    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.KNOWN);
    expect(hasPositiveValue(record.value)).toBe(true);
  });

  it('adapter forwards analyzedRevision (pythonAdapter) -> mismatch degrades to UNKNOWN', async () => {
    const { pythonAdapter } = await import('../../../src/adapters/python/adapter');
    const report = writeReport('rev1');
    const output = pythonAdapter.collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      coverageReport: report,
      analyzedRevision: 'rev2',
    } as any);
    const record = output.evidence['line_coverage'];
    expect(record).toBeDefined();
    expect(record.availability).toBe(Availability.UNKNOWN);
    expect(record.reason).toContain('source revision mismatch');
  });
});

describe('Phase 9 task 1.3 — evidenceStrength (D10)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-strength-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  it('pytest straight-line test-body asserts → EXECUTION_ESTABLISHED', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    }
  });

  it('unittest TestClass method asserts → EXECUTION_ESTABLISHED (class-method containment is not nesting)', () => {
    const output = collectAnalysis(join(FIXTURES, 'unittest_sample.py'));
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    }
  });

  it('assert inside a helper function called from the test body → SYNTAX_OBSERVED', () => {
    const file = write('def test_a():\n    def helper():\n        assert 1\n    helper()\n');
    const output = collectAnalysis(file);
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    }
  });

  it('assert inside if/for/while branch within the test body → SYNTAX_OBSERVED', () => {
    const file = write(
      'def test_a():\n    if True:\n        assert 1\n    for i in range(2):\n        assert i >= 0\n    while False:\n        assert 2\n',
    );
    const output = collectAnalysis(file);
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    }
  });

  it('@given-decorated test → SYNTAX_OBSERVED with CollectionStatus.PARTIAL retained', () => {
    const output = collectAnalysis(join(FIXTURES, 'hypothesis_given.py'));
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    expect(output.evidence['assertion_count'].coverage.status).toBe(CollectionStatus.PARTIAL);
    const scope = (output.tests ?? [])[0];
    expect(scope).toBeDefined();
    expect(scope!.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    expect(scope!.evidence['assertion_count'].coverage.status).toBe(CollectionStatus.PARTIAL);
  });

  it('zero-assert @given + straight-line assert test → subject SYNTAX_OBSERVED (D10: @given is syntax-form regardless of assert count)', () => {
    const file = write(
      'from hypothesis import given, strategies as st\n\n@given(st.integers())\ndef test_prop(x):\n    pass\n\ndef test_straight():\n    assert True\n',
    );
    const output = collectAnalysis(file);
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
  });

  it('unsupported/unclassifiable assert form → UNSUPPORTED', () => {
    const file = write('def test_a():\n    foo.raises(Exception)\n');
    const output = collectAnalysis(file);
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
    }
  });

  it('parity: non-pytest .raises is COUNTED (totalAsserts) + UNSUPPORTED on the AST-substrate path', () => {
    const file = write('def test_a():\n    foo.raises(Exception)\n');
    // Force the earned python3-ast fallback so the AST_SCRIPT path is the one
    // exercised (native substrate unavailable).
    const output = collectAnalysis(file, {
      substrateProbe: fakeProbe(fakeTreeSitter(true)),
    } as any);
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    // totalAsserts must include the non-pytest .raises form (parity with native).
    expect(output.evidence['assertion_count'].value).toBe(1);
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
    for (const scope of output.tests ?? []) {
      expect(scope.evidence['assertion_count'].value).toBe(1);
      expect(scope.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
    }
  });
});

import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import {
  AnalysisStatus,
  AnalysisOutput,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../../src/core/analysis';
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

  it('hypothesis @given → assertion_count KNOWN, counted, PARTIAL, reason "property-based" (D-20261117-2 Q1)', () => {
    const output = collectAnalysis(join(FIXTURES, 'hypothesis_given.py'));
    const record = output.evidence['assertion_count'];

    // PARTIAL coverage retained (count not case-exhaustive) -> verdict stays
    // INDETERMINATE via the completeness guard; but the count is now KNOWN.
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.value as number).toBeGreaterThan(0);
    expect(record.reason).toContain('property-based');
    expect(record.reason).not.toContain('unsupported-form');
    // @given records are tagged property_based (present-only, never false).
    expect((record as { property_based?: boolean }).property_based).toBe(true);
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

  it('@given-decorated test → SYNTAX_OBSERVED with CollectionStatus.PARTIAL retained + property_based tag (D-20261117-2 Q1)', () => {
    const output = collectAnalysis(join(FIXTURES, 'hypothesis_given.py'));
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    expect(output.evidence['assertion_count'].coverage.status).toBe(CollectionStatus.PARTIAL);
    expect((output.evidence['assertion_count'] as { property_based?: boolean }).property_based).toBe(true);
    const scope = (output.tests ?? [])[0];
    expect(scope).toBeDefined();
    expect(scope!.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    expect(scope!.evidence['assertion_count'].coverage.status).toBe(CollectionStatus.PARTIAL);
    expect((scope!.evidence['assertion_count'] as { property_based?: boolean }).property_based).toBe(true);
  });

  it('zero-assert @given + straight-line assert test → subject SYNTAX_OBSERVED + property_based tagged on subject', () => {
    const file = write(
      'from hypothesis import given, strategies as st\n\n@given(st.integers())\ndef test_prop(x):\n    pass\n\ndef test_straight():\n    assert True\n',
    );
    const output = collectAnalysis(file);
    expect(output.evidence['assertion_count'].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    expect((output.evidence['assertion_count'] as { property_based?: boolean }).property_based).toBe(true);
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

/* ------------------------------------------------------------------ *
 * Test id uniqueness — per-line declaration index (plan task 4.2)
 * ------------------------------------------------------------------ */

describe('collectAnalysis — python test id uniqueness (plan task 4.2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-id-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  function ids(output: AnalysisOutput): string[] {
    return (output.tests ?? []).map((scope) => scope.test.id);
  }

  /**
   * Module tree with TWO `def test_dup()` declarations reported on the SAME
   * source row. Valid Python cannot produce this — a `def` is a compound
   * statement and owns its logical line (`def a(): pass; def b(): pass` is a
   * SyntaxError) — so the shape is reachable only through the fake
   * tree-sitter seam. The collector must still hand out two distinct ids.
   */
  function fakeSameLineTree(): FakeNode {
    const declaration = (): FakeNode => {
      const name = fakeNode({ type: 'identifier', text: 'test_dup', row: 0 });
      const assertion = fakeNode({ type: 'assert_statement', text: 'assert 1', row: 1 });
      const body = fakeNode({ type: 'block', text: '    assert 1', row: 1, children: [assertion] });
      return fakeNode({
        type: 'function_definition',
        text: 'def test_dup():',
        row: 0,
        endRow: 1,
        children: [name, body],
        fields: { name, body },
      });
    };
    return fakeNode({
      type: 'module',
      text: '',
      row: 0,
      endRow: 1,
      children: [declaration(), declaration()],
    });
  }

  /** Same tree, but the two declarations sit on DIFFERENT rows. */
  function fakeTwoLineTree(): FakeNode {
    const declaration = (row: number): FakeNode => {
      const name = fakeNode({ type: 'identifier', text: 'test_dup', row });
      const assertion = fakeNode({ type: 'assert_statement', text: 'assert 1', row: row + 1 });
      const body = fakeNode({ type: 'block', text: '    assert 1', row: row + 1, children: [assertion] });
      return fakeNode({
        type: 'function_definition',
        text: 'def test_dup():',
        row,
        endRow: row + 1,
        children: [name, body],
        fields: { name, body },
      });
    };
    return fakeNode({
      type: 'module',
      text: '',
      row: 0,
      endRow: 3,
      children: [declaration(0), declaration(2)],
    });
  }

  function treeProbe(tree: () => FakeNode): SubstrateProbe {
    class TreeParser {
      setLanguage(_language: unknown): void {}
      parse(_src: string): { rootNode: FakeNode | undefined } {
        return { rootNode: tree() };
      }
    }
    return {
      require(id: string): unknown {
        if (id === 'tree-sitter') return TreeParser;
        if (id === 'tree-sitter-python') return { name: 'fake-python' };
        throw new Error(`unexpected native module ${id}`);
      },
    };
  }

  it('gives two same-name declarations on one line distinct ids', () => {
    const file = write('def test_dup():\n    assert 1\n');
    const output = collectAnalysis(file, { substrateProbe: treeProbe(fakeSameLineTree) });

    expect(ids(output)).toEqual([`${file}#test_dup@1:0`, `${file}#test_dup@1:1`]);
  });

  it('numbers each line independently — a declaration on a new line starts at index 0', () => {
    const file = write('def test_dup():\n    assert 1\n');
    const output = collectAnalysis(file, { substrateProbe: treeProbe(fakeTwoLineTree) });

    expect(ids(output)).toEqual([`${file}#test_dup@1:0`, `${file}#test_dup@3:0`]);
  });

  it('ids follow <file>#<name>@<line>:<index> on a real python file', () => {
    const file = write('def test_a():\n    assert 1\n\ndef test_b():\n    assert 2\n');
    const output = collectAnalysis(file);

    expect(ids(output)).toEqual([`${file}#test_a@1:0`, `${file}#test_b@4:0`]);
  });

  it('keeps ids unique within one analysis and identical across two runs', () => {
    const file = write('def test_dup():\n    assert 1\n');
    const first = ids(collectAnalysis(file, { substrateProbe: treeProbe(fakeSameLineTree) }));
    const second = ids(collectAnalysis(file, { substrateProbe: treeProbe(fakeSameLineTree) }));

    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
  });
});

/* ------------------------------------------------------------------ *
 * pytest parametrize — declaration identity (plan task 4.5)
 *
 * The collector does STATIC analysis: it records one declaration per `def`,
 * NOT one entry per parametrize case. `@pytest.mark.parametrize` decorators
 * do not expand into multiple test entries and do not add a `[param]` suffix
 * to the test name (verified against the real collector 2026-11-15). The id
 * therefore stays `<file>#<name>@<line>:<index>` with the bare def name.
 * ------------------------------------------------------------------ */

describe('collectAnalysis — pytest parametrize declaration identity (plan task 4.5)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-param-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  function ids(output: AnalysisOutput): string[] {
    return (output.tests ?? []).map((scope) => scope.test.id);
  }

  it('single @parametrize: one declaration entry, bare name, no [param] suffix', () => {
    const file = write('import pytest\n\n@pytest.mark.parametrize("x", [1, 2])\ndef test_p(x):\n    assert x > 0\n');
    const output = collectAnalysis(file);
    const scopes = output.tests ?? [];

    expect(scopes).toHaveLength(1);
    expect(scopes[0].test.name).toBe('test_p');
    expect(ids(output)).toEqual([`${file}#test_p@4:0`]);
  });

  it('two stacked @parametrize decorators on one def: still one entry, both decorators ignored for identity', () => {
    const file = write(
      'import pytest\n\n@pytest.mark.parametrize("y", [3])\n@pytest.mark.parametrize("z", [4])\ndef test_multi(y, z):\n    assert y + z > 0\n',
    );
    const output = collectAnalysis(file);
    const scopes = output.tests ?? [];

    expect(scopes).toHaveLength(1);
    expect(scopes[0].test.name).toBe('test_multi');
    expect(ids(output)).toEqual([`${file}#test_multi@5:0`]);
  });

  it('parametrize + plain def: ids unique within analysis and deterministic across runs', () => {
    const src =
      'import pytest\n\n@pytest.mark.parametrize("x", [1, 2])\ndef test_p(x):\n    assert x > 0\n\ndef test_plain():\n    assert True\n';
    const file = write(src);
    const first = ids(collectAnalysis(file));
    const second = ids(collectAnalysis(file));

    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
    expect(first).toEqual([`${file}#test_p@4:0`, `${file}#test_plain@7:0`]);
  });
});

describe('Phase 9 task 7.1 — framework attribution (F1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-fw-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  it('pytest-shaped file -> subject.framework pytest', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'));
    expect(output.subject.framework).toBe('pytest');
  });

  it('unittest-shaped file -> subject.framework unittest', () => {
    const output = collectAnalysis(join(FIXTURES, 'unittest_sample.py'));
    expect(output.subject.framework).toBe('unittest');
  });

  it('mixed file -> per-test attribution (pytest + unittest), analysis SUCCESS, subject pytest-first', () => {
    const file = write(
      'import pytest\n\ndef test_py():\n    assert True\n\nimport unittest\n\nclass TestMixed(unittest.TestCase):\n    def test_un(self):\n        self.assertEqual(1, 1)\n',
    );
    const output = collectAnalysis(file);
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_py')?.test.framework).toBe('pytest');
    expect(byName.get('test_un')?.test.framework).toBe('unittest');
    expect(byName.get('test_py')?.framework).toBe('pytest');
    expect(byName.get('test_un')?.framework).toBe('unittest');
    expect(output.subject.framework).toBe('pytest');
  });
});

describe('Phase 9 task 7.11 — framework attribution hot-fix (AST walk, no string-literal FPs)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-fw711-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  it('(a) pytester-style triple-quoted unittest snippet in module-level def test_x -> per-test pytest (native)', () => {
    const file = write(
      'def test_x(pytester):\n    pytester.makepyfile("""\nimport unittest\nclass MyTestCase(unittest.TestCase):\n    def test_inner(self):\n        self.assertEqual(1, 1)\n""")\n    assert True\n',
    );
    const output = collectAnalysis(file);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_x')?.test.framework).toBe('pytest');
    expect(byName.get('test_x')?.framework).toBe('pytest');
    expect(output.subject.framework).toBe('pytest');
  });

  it('(b) module-level def test_y with ACTUAL self.assertEqual call in body -> unittest (native)', () => {
    const file = write('def test_y():\n    self.assertEqual(1, 1)\n');
    const output = collectAnalysis(file);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_y')?.test.framework).toBe('unittest');
    expect(byName.get('test_y')?.framework).toBe('unittest');
    expect(output.subject.framework).toBe('unittest');
  });

  it('(c) string-only "self.assertEqual(" mention inside normal call arg -> pytest (native)', () => {
    const file = write('def test_z():\n    note("self.assertEqual(1, 1)")\n    assert True\n');
    const output = collectAnalysis(file);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_z')?.test.framework).toBe('pytest');
    expect(output.subject.framework).toBe('pytest');
  });

  it('(d) Test* class method -> unittest (regression pin, native)', () => {
    const file = write(
      'import unittest\n\nclass TestMixed(unittest.TestCase):\n    def test_un(self):\n        self.assertEqual(1, 1)\n',
    );
    const output = collectAnalysis(file);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_un')?.test.framework).toBe('unittest');
    expect(output.subject.framework).toBe('unittest');
  });

  it('(e) mixed file (pytest-labeled module def + unittest class): subject pytest-first (native)', () => {
    const file = write(
      'def test_x(pytester):\n    pytester.makepyfile("""\nimport unittest\nclass MyTestCase(unittest.TestCase):\n    def test_inner(self):\n        self.assertEqual(1, 1)\n""")\n    assert True\n\nimport unittest\n\nclass TestMixed(unittest.TestCase):\n    def test_un(self):\n        self.assertEqual(1, 1)\n',
    );
    const output = collectAnalysis(file);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_x')?.test.framework).toBe('pytest');
    expect(byName.get('test_un')?.test.framework).toBe('unittest');
    expect(output.subject.framework).toBe('pytest');
  });

  it('(f) AST fallback: triple-quoted unittest snippet in module def -> pytest, subject pytest-first', () => {
    const file = write(
      'def test_x(pytester):\n    pytester.makepyfile("""\nimport unittest\nclass MyTestCase(unittest.TestCase):\n    def test_inner(self):\n        self.assertEqual(1, 1)\n""")\n    assert True\n\nimport unittest\n\nclass TestMixed(unittest.TestCase):\n    def test_un(self):\n        self.assertEqual(1, 1)\n',
    );
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) } as any);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_x')?.test.framework).toBe('pytest');
    expect(byName.get('test_un')?.test.framework).toBe('unittest');
    expect(output.subject.framework).toBe('pytest');
  });

  it('(f) AST fallback: actual self.assert call in module def -> unittest', () => {
    const file = write('def test_y():\n    self.assertEqual(1, 1)\n');
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) } as any);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_y')?.test.framework).toBe('unittest');
    expect(output.subject.framework).toBe('unittest');
  });

  it('(f) AST fallback: string-only self.assert mention in call arg -> pytest', () => {
    const file = write('def test_z():\n    note("self.assertEqual(1, 1)")\n    assert True\n');
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) } as any);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    expect(byName.get('test_z')?.test.framework).toBe('pytest');
    expect(output.subject.framework).toBe('pytest');
  });
});

/* ------------------------------------------------------------------ *
 * M5 (plan task 3, RED-first) — decorated class-member test methods
 *
 * Bug: the native tree-sitter class-member loop (collector.ts walkNative
 * :491-494) accepts only `function_definition` members via
 * isTestFunction(member); decorated methods appear as `decorated_definition`
 * in class bodies and are SKIPPED. The module-level loop already unwraps
 * (:482-484). The stdlib-ast fallback (AST_SCRIPT :178-185) already
 * collects decorated methods (Python ast stores them as plain FunctionDef
 * with decorator_list; is_test matches), so the fallback tests below pin
 * already-correct behavior and must stay GREEN; only the native tests are
 * RED until task 2 mirrors the module-level unwrap in the class loop.
 * ------------------------------------------------------------------ */

describe('M5: decorated class-member test methods (native vs python3-ast fallback)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-m5-decor-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  // Valid Python: plain method, @staticmethod-decorated method,
  // @property-decorated method — all named test_* inside a Test* class.
  const SRC = [
    'import unittest',
    '',
    'class TestSample(unittest.TestCase):',
    '    def test_plain(self):',
    '        self.assertEqual(1, 1)',
    '',
    '    @staticmethod',
    '    def test_static():',
    '        assert True',
    '',
    '    @property',
    '    def test_prop(self):',
    '        return 42',
    '',
  ].join('\n');

  it('(a) native tree-sitter path collects plain + decorated class members, framework unittest', () => {
    const file = write(SRC);
    const output = collectAnalysis(file);
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    // RED before task 2: decorated_definition members are skipped by the
    // native class-member loop; test_static and test_prop are absent.
    expect(byName.has('test_plain')).toBe(true);
    expect(byName.has('test_static')).toBe(true);
    expect(byName.has('test_prop')).toBe(true);
    expect(byName.get('test_plain')!.test.framework).toBe('unittest');
    expect(byName.get('test_static')!.test.framework).toBe('unittest');
    expect(byName.get('test_prop')!.test.framework).toBe('unittest');
    expect(output.subject.framework).toBe('unittest');
  });

  it('(b) python3-ast fallback (forced) collects plain + decorated class members, framework unittest', () => {
    const file = write(SRC);
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) } as any);
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    const byName = new Map((output.tests ?? []).map((s) => [s.test.name, s]));
    // GREEN before and after task 2: stdlib ast already collects decorated
    // methods as plain FunctionDef with decorator_list.
    expect(byName.has('test_plain')).toBe(true);
    expect(byName.has('test_static')).toBe(true);
    expect(byName.has('test_prop')).toBe(true);
    expect(byName.get('test_plain')!.test.framework).toBe('unittest');
    expect(byName.get('test_static')!.test.framework).toBe('unittest');
    expect(byName.get('test_prop')!.test.framework).toBe('unittest');
    expect(output.subject.framework).toBe('unittest');
  });
});

/* ------------------------------------------------------------------ *
 * D-20261117-2 (task 0, RED) — decoratedWithGiven FALSE POSITIVE
 *
 * Bug: the native decoratedWithGiven() (collector.ts:365-371) matches
 * /\bgiven\b/ over the WHOLE decorator text span, so a plain
 * @pytest.mark.parametrize(...) whose argument list contains a COMMENT line
 * with the word "given" (corpus prose: "# should be True for the given
 * operator") is mis-detected as a hypothesis @given test -> the assertion
 * count is zero-suppressed (value undefined / UNKNOWN / PARTIAL /
 * unsupported-form). The stdlib-ast fallback (AST_SCRIPT decs() :129-134,
 * `"given" in decs(...)` :182/:184) is name-based and does NOT
 * false-positive -> the two substrates diverge on DETECTION.
 *
 * Fix (task 2): name-anchored detection — match the decorator CALL NAME only.
 * RED here: the native test fails pre-fix (given=true); the forced-fallback
 * test already passes (pins the correct behavior the native path must match).
 * ------------------------------------------------------------------ */

describe('D-20261117-2: decoratedWithGiven detection false positive (task 0)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-given-fp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  // Corpus-shaped: @pytest.mark.parametrize whose arg list carries a COMMENT
  // line containing the word "given" — tree-sitter keeps the comment INSIDE
  // the `decorator` node span, so /\bgiven\b/ over decorator.text matches.
  const PARAMETRIZE_WITH_GIVEN_COMMENT = [
    'import pytest',
    '@pytest.mark.parametrize(',
    '    "version",',
    '    [',
    '        # should be True for the given operator',
    '        "1.0.0",',
    '    ],',
    ')',
    'def test_comparison(version):',
    '    assert Version(version)',
    '',
  ].join('\n');

  it('(native) parametrize-with-"given"-comment is NOT a @given test (value counted, no property_based)', () => {
    const file = write(PARAMETRIZE_WITH_GIVEN_COMMENT);
    const output = collectAnalysis(file);
    const record = output.evidence['assertion_count'];
    const scope = (output.tests ?? []).find((s) => s.test.name === 'test_comparison')!;
    const scopeRecord = scope.evidence['assertion_count'];

    // RED pre-fix: native given=true -> value undefined / UNKNOWN / PARTIAL.
    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(record.value as number).toBeGreaterThan(0);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect((record as { property_based?: boolean }).property_based).toBeUndefined();
    expect(scopeRecord.value as number).toBeGreaterThan(0);
    expect(scopeRecord.availability).toBe(Availability.KNOWN);
    expect(scopeRecord.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect((scopeRecord as { property_based?: boolean }).property_based).toBeUndefined();
  });

  it('(forced fallback) parametrize-with-"given"-comment is NOT a @given test — parity', () => {
    const file = write(PARAMETRIZE_WITH_GIVEN_COMMENT);
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) } as any);
    const record = output.evidence['assertion_count'];
    const scope = (output.tests ?? []).find((s) => s.test.name === 'test_comparison')!;
    const scopeRecord = scope.evidence['assertion_count'];

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(record.value as number).toBeGreaterThan(0);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect((record as { property_based?: boolean }).property_based).toBeUndefined();
    expect(scopeRecord.value as number).toBeGreaterThan(0);
    expect(scopeRecord.availability).toBe(Availability.KNOWN);
    expect(scopeRecord.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect((scopeRecord as { property_based?: boolean }).property_based).toBeUndefined();
  });

  it('(control) a real @given(st.integers()) decorator IS still detected as @given on both substrates', () => {
    const file = write(
      'from hypothesis import given, strategies as st\n\n@given(st.integers())\ndef test_prop(x):\n    assert x + 0 == x\n',
    );
    for (const opts of [undefined, { substrateProbe: fakeProbe(fakeTreeSitter(true)) }] as any[]) {
      const output = collectAnalysis(file, opts);
      const scope = (output.tests ?? []).find((s) => s.test.name === 'test_prop')!;
      expect(scope).toBeDefined();
      // Detection fires for a REAL @given: the scope record carries the @given
      // note in its reason (pre-fix 'unsupported-form', post-fix 'property-based').
      // A detection regression would leave the record value-counted with no reason.
      expect(scope.evidence['assertion_count'].reason).toMatch(/hypothesis @given/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * D-20261117-2 (task 1a, RED) — @given estimate_marker (new semantics)
 *
 * Owner ruling D-20261117-2 Q1: python adapter COUNTS assert statements
 * inside hypothesis @given bodies into assertion_count (value > 0),
 * availability KNOWN (was UNKNOWN), coverage PARTIAL retained (count not
 * case-exhaustive -> verdict stays INDETERMINATE), reason carries
 * 'property-based' (NOT 'unsupported-form'), and the record is tagged
 * property_based === true. Subject-level aggregate mirrors the tag.
 *
 * RED pre-fix: given tests zero-suppress -> value undefined / UNKNOWN /
 * unsupported-form / no property_based key.
 * ------------------------------------------------------------------ */

describe('D-20261117-2: @given estimate_marker semantics (task 1a)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-given-marker-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(src: string): string {
    const file = join(dir, 'case.py');
    writeFileSync(file, src, 'utf8');
    return file;
  }

  const GIVEN_SRC = [
    'from hypothesis import given, strategies as st',
    '',
    '',
    '@given(st.integers())',
    'def test_prop(x):',
    '    assert x + 0 == x',
    '    assert isinstance(x, int)',
    '',
  ].join('\n');

  it('(a) real @given body asserts counted: value > 0, KNOWN, property_based, PARTIAL, reason property-based', () => {
    const file = write(GIVEN_SRC);
    const output = collectAnalysis(file);
    const scope = (output.tests ?? []).find((s) => s.test.name === 'test_prop')!;
    const record = scope.evidence['assertion_count'];

    expect(record.value as number).toBeGreaterThan(0);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect((record as { property_based?: boolean }).property_based).toBe(true);
    expect(record.reason).toContain('property-based');
    expect(record.reason).not.toContain('unsupported-form');
  });

  it('(b) subject-level aggregate carries property_based === true for a file with @given', () => {
    const file = write(GIVEN_SRC);
    const output = collectAnalysis(file);
    const record = output.evidence['assertion_count'];

    expect(record.value as number).toBeGreaterThan(0);
    expect((record as { property_based?: boolean }).property_based).toBe(true);
  });

  it('(c) parity: forced python3-ast fallback substrate -> same (a)+(b) hold', () => {
    const file = write(GIVEN_SRC);
    const output = collectAnalysis(file, { substrateProbe: fakeProbe(fakeTreeSitter(true)) } as any);
    const scope = (output.tests ?? []).find((s) => s.test.name === 'test_prop')!;
    const record = scope.evidence['assertion_count'];
    const subjectRecord = output.evidence['assertion_count'];

    expect(record.value as number).toBeGreaterThan(0);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect((record as { property_based?: boolean }).property_based).toBe(true);
    expect(record.reason).toContain('property-based');
    expect(record.reason).not.toContain('unsupported-form');
    expect(subjectRecord.value as number).toBeGreaterThan(0);
    expect((subjectRecord as { property_based?: boolean }).property_based).toBe(true);
  });

  it('(d) non-@given tests unchanged: no property_based key, value unchanged', () => {
    const file = join(FIXTURES, 'pytest_sample.py');
    const output = collectAnalysis(file);
    const record = output.evidence['assertion_count'];

    expect(record.value as number).toBeGreaterThan(0);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(record.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect((record as { property_based?: boolean }).property_based).toBeUndefined();
    for (const scope of output.tests ?? []) {
      expect((scope.evidence['assertion_count'] as { property_based?: boolean }).property_based).toBeUndefined();
      expect(scope.evidence['assertion_count'].value as number).toBeGreaterThan(0);
    }
  });
});

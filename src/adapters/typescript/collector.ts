/**
 * TypeScript/Jest adapter — deterministic AST collector (plan task 3).
 *
 * `ts.createSourceFile` -> parse diagnostics -> framework detection -> walk the
 * test bodies of the file for `expect()` chains. Produces normalized
 * `AnalysisOutput` built ONLY from `src/core` types; no AST node escapes this
 * module (KickOff:134).
 *
 * Guardrails honoured here:
 *   - adapter -> core only; `src/core` and `src/rules` never import `typescript`
 *   - deterministic: no clock, no randomness, no I/O beyond reading the file
 *   - the test file is never executed at runtime (out of scope, KickOff:194)
 *
 * Executability (A7): an assertion is `established` only when it sits in the
 * straight-line body of a test. It is `unestablished` after an unconditional
 * return/throw, inside a nested block or callback, or inside a declaration form
 * we do not fully support — mere presence does not prove execution
 * (KickOff:108-109). The precise definition is STRAIGHT_LINE below (E).
 *
 * Declarations (F): every `it`/`test` call site is located, including the forms
 * the collector does not fully support (`each`, `skip`, `only`, `todo`, ...).
 * Each one is reported with a reason; none is silently omitted.
 *
 * Framework detection stays FILE-scoped (plan task 7, hardening c): imports are
 * module-scoped, so a mixed file has no per-test framework. Such a file is
 * UNSUPPORTED and emits NO per-test records at all — a per-test PASS on a file
 * whose framework was never established would be exactly the over-claim the
 * whole design avoids.
 */

import { readFileSync } from 'fs';
import { basename } from 'path';

import ts from 'typescript';

import {
  AnalysisOutput,
  AnalysisStatus,
  AnalysisSubject,
  AnalysisSummary,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestScopeResult,
  TestType,
} from '../../core/analysis';
import {
  CollectionStatus,
  EvidenceRecord,
  Provenance,
  deriveAvailability,
  makeEvidenceRecord,
} from '../../core/evidence';
import {
  ANALYZER_ID,
  ANALYSIS_SCOPE,
  COLLECTOR_VERSION,
  EVIDENCE_ASSERTION_COUNT,
  SUPPORTED_ASSERTION_FORMS,
  SUPPORTED_FRAMEWORKS,
  TestDeclaration,
  DeclarationGap,
  DeclarationSite,
  classifyForm,
  classifyTestDeclaration,
  collectTestAliases,
  declarationGapReason,
  declarationLabel,
  declarationName,
  declarationSite,
  detectFrameworkDetail,
  isCapabilityGap,
  isExpectChain,
  looksLikeCustomHelper,
  rootIdentifier,
  shortText,
  UNSUPPORTED_ASSERTION_NAMESPACES,
} from './support';

/** `parseDiagnostics` is internal to the compiler but stable across TS 5/6 releases. */
interface SourceFileWithParseDiagnostics extends ts.SourceFile {
  parseDiagnostics: readonly ts.Diagnostic[];
}

const REASON_AFTER_HALT =
  'assertion appears after an unconditional return/throw; execution cannot be established statically';
const REASON_CALLBACK = 'assertion is inside a callback; callback execution cannot be established statically';
const REASON_NESTED_BLOCK =
  'assertion is inside a nested block (if/loop/try/switch); straight-line execution cannot be established statically';

/**
 * P1.3 — reported when the framework was DERIVED from bare-global identifiers
 * rather than a runtime import (support.ts `detectFrameworkDetail`). Names the
 * inferred signal and the ambiguity it cannot resolve, so the derivation is
 * never read as proof (docs/limitations.md §4).
 */
const FRAMEWORK_DERIVED_REASON =
  "framework 'jest' derived from bare-global test declarations and expect() usage with no framework import; " +
  'bare globals cannot distinguish jest from mocha/chai/jasmine, so assertions are counted only when the matcher matches a supported form';

/** One assertion-like construct found in a test body. */
interface AssertionFinding {
  /** Supported form ID, or null when the construct could not be classified. */
  form: string | null;
  /** True only for a recognized form in a straight-line test body. */
  established: boolean;
  /** Why the value is unknown/partial. Empty when fully established. */
  reason: string;
  /** Short source rendering, used in reasons. */
  syntax: string;
  line: number;
}

/** Findings owned by EXACTLY one declaration site (plan task 1 — never summed across declarations). */
interface DeclarationFindings {
  site: DeclarationSite;
  findings: AssertionFinding[];
}

/**
 * Collect normalized evidence for one test file.
 *
 * @param filePath path to the test file to analyze
 * @param declaredType caller-declared test type; never inferred (A3, SPEC:450-458)
 */
export function collectAnalysis(filePath: string, declaredType: TestType = TestType.UNKNOWN): AnalysisOutput {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf8');
  } catch (error) {
    return failed(filePath, declaredType, undefined, `unable to read test file: ${(error as Error).message}`);
  }

  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const parseDiagnostics = (sourceFile as SourceFileWithParseDiagnostics).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    return failed(filePath, declaredType, undefined, formatParseDiagnostics(sourceFile, parseDiagnostics));
  }

  const detection = detectFrameworkDetail(sourceFile);
  const framework = detection.framework;
  if (!SUPPORTED_FRAMEWORKS.includes(framework)) {
    return unsupported(filePath, declaredType, framework);
  }

  const perDeclaration = collectTestBodyFindings(sourceFile, collectTestAliases(sourceFile));
  return supported(filePath, declaredType, framework, perDeclaration, detection.derived);
}

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

function subject(filePath: string, declaredType: TestType, framework?: string): AnalysisSubject {
  return {
    id: filePath,
    name: basename(filePath),
    file: filePath,
    language: 'typescript',
    ...(framework === undefined ? {} : { framework }),
    type: declaredType,
  };
}

function summary(status: AnalysisStatus, completeness: Completeness, declaredType: TestType): AnalysisSummary {
  return {
    status,
    completeness,
    scope: ANALYSIS_SCOPE,
    test_type: {
      value: declaredType,
      // A3 — the type is declared by the caller or defaults; never inferred.
      source: declaredType === TestType.UNKNOWN ? ClassificationSource.DEFAULT : ClassificationSource.EXPLICIT,
    },
  };
}

/** Named capabilities reported alongside the evidence (SPEC:395-399). */
function capabilitiesOf(status: CollectionStatus): Record<string, CapabilityStatus> {
  return {
    assertion_forms:
      status === CollectionStatus.COMPLETE
        ? CapabilityStatus.AVAILABLE
        : status === CollectionStatus.PARTIAL
          ? CapabilityStatus.PARTIAL
          : CapabilityStatus.UNAVAILABLE,
    // A1 — no cross-file helper resolution in milestone-1.
    custom_helper_resolution: CapabilityStatus.UNAVAILABLE,
    // KickOff:194 — the test file is never executed.
    runtime_execution: CapabilityStatus.UNAVAILABLE,
  };
}

function coverage(status: CollectionStatus) {
  return {
    status,
    supported_frameworks: [...SUPPORTED_FRAMEWORKS],
    supported_assertion_forms: [...SUPPORTED_ASSERTION_FORMS],
  };
}

/** Parse diagnostics preserved in the report (plan §8 — never stderr-only). */
function formatParseDiagnostics(sourceFile: ts.SourceFile, diagnostics: readonly ts.Diagnostic[]): string {
  const shown = diagnostics.slice(0, 5).map((diagnostic) => {
    const position = diagnostic.start ?? 0;
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    return `TS${diagnostic.code} ${message} (line ${line + 1})`;
  });
  const suffix = diagnostics.length > shown.length ? `, +${diagnostics.length - shown.length} more` : '';
  return `parse diagnostics (${diagnostics.length}): ${shown.join('; ')}${suffix}`;
}

function failed(
  filePath: string,
  declaredType: TestType,
  framework: string | undefined,
  reason: string,
): AnalysisOutput {
  const record = makeEvidenceRecord({
    type: EVIDENCE_ASSERTION_COUNT,
    value: undefined,
    // No value was established — never report a fabricated zero (KickOff:72).
    availability: deriveAvailability(CollectionStatus.UNAVAILABLE),
    provenance: Provenance.DIRECT,
    source: ANALYZER_ID,
    collector_version: COLLECTOR_VERSION,
    scope: ANALYSIS_SCOPE,
    coverage: coverage(CollectionStatus.UNAVAILABLE),
    reason,
  });
  return {
    subject: subject(filePath, declaredType, framework),
    // A failed scan is never COMPLETE (SPEC:425).
    analysis: summary(AnalysisStatus.FAILED, Completeness.INCOMPLETE, declaredType),
    evidence: { [EVIDENCE_ASSERTION_COUNT]: record },
    capabilities: capabilitiesOf(CollectionStatus.UNAVAILABLE),
  };
}

function unsupported(filePath: string, declaredType: TestType, framework: string): AnalysisOutput {
  const reason = `framework '${framework}' is outside the supported framework list [${SUPPORTED_FRAMEWORKS.join(', ')}]`;
  const record = makeEvidenceRecord({
    type: EVIDENCE_ASSERTION_COUNT,
    value: undefined,
    // An unsupported framework is a CAPABILITY GAP, not an irrelevant evidence
    // type: assertion_count still applies to a vitest test, we simply cannot
    // collect it. A8's primary mapping applies — UNAVAILABLE -> UNKNOWN — so the
    // engine's unknown_evidence_policy can fire (KickOff:72: never let a gap
    // read as an absent value).
    availability: deriveAvailability(CollectionStatus.UNAVAILABLE),
    provenance: Provenance.DIRECT,
    source: ANALYZER_ID,
    collector_version: COLLECTOR_VERSION,
    scope: ANALYSIS_SCOPE,
    coverage: coverage(CollectionStatus.UNAVAILABLE),
    reason,
  });
  return {
    subject: subject(filePath, declaredType, framework),
    analysis: summary(AnalysisStatus.UNSUPPORTED, Completeness.NOT_APPLICABLE, declaredType),
    evidence: { [EVIDENCE_ASSERTION_COUNT]: record },
    capabilities: capabilitiesOf(CollectionStatus.UNAVAILABLE),
  };
}

function supported(
  filePath: string,
  declaredType: TestType,
  framework: string,
  perDeclaration: DeclarationFindings[],
  frameworkDerived = false,
): AnalysisOutput {
  const declarations = perDeclaration.map((entry) => entry.site);
  const findings = perDeclaration.flatMap((entry) => entry.findings);
  const recognized = findings.filter((finding) => finding.form !== null);
  const unclassified = findings.filter((finding) => finding.form === null);
  const established = recognized.filter((finding) => finding.established);
  const gaps = declarations.filter((site) => isCapabilityGap(site.gap));

  // COMPLETE means "the collector could classify every construct AND establish
  // executability for each one" — an empty test body is COMPLETE with value 0.
  const nonePresent = findings.length === 0 && gaps.length === 0;
  const allEstablished = unclassified.length === 0 && gaps.length === 0 && established.length === recognized.length;
  const coverageStatus = nonePresent || allEstablished ? CollectionStatus.COMPLETE : CollectionStatus.PARTIAL;

  const record = makeEvidenceRecord({
    type: EVIDENCE_ASSERTION_COUNT,
    // Only ESTABLISHED assertions are counted (A7). The availability + reason
    // below carry the truth about what was not establishable.
    value: established.length,
    availability: deriveAvailability(coverageStatus),
    provenance: Provenance.DIRECT,
    source: ANALYZER_ID,
    collector_version: COLLECTOR_VERSION,
    scope: ANALYSIS_SCOPE,
    coverage: coverage(coverageStatus),
  });

  // Recognition completeness, reported separately from coverage status (SPEC:366).
  // An unclassifiable assertion is a recognition gap; so is a declaration form
  // whose body we cannot cover, because the construct itself was not understood.
  const completeness = unclassified.length > 0 || gaps.length > 0 ? Completeness.INCOMPLETE : Completeness.COMPLETE;

  // The derived-framework note leads, so the inference is stated before any
  // coverage detail (P1.3).
  const reasonParts: string[] = [];
  if (frameworkDerived) {
    reasonParts.push(FRAMEWORK_DERIVED_REASON);
  }
  const coverageNote = coverageReason(unclassified, recognized, nonePresent, declarations);
  if (coverageNote !== undefined) {
    reasonParts.push(coverageNote);
  }
  if (reasonParts.length > 0) {
    record.reason = reasonParts.join(' | ');
  }
  const first = findings[0];
  if (first !== undefined) {
    record.location = { file: filePath, line: first.line };
  }

  return {
    subject: subject(filePath, declaredType, framework),
    analysis: summary(AnalysisStatus.SUCCESS, completeness, declaredType),
    evidence: { [EVIDENCE_ASSERTION_COUNT]: record },
    capabilities: {
      ...capabilitiesOf(coverageStatus),
      // P1.3 — a DERIVED framework is a partial capability: the framework was
      // inferred from bare globals, not observed from a runtime import.
      ...(frameworkDerived ? { framework_detection: CapabilityStatus.PARTIAL } : {}),
    },
    // Per-declaration records appended LAST (plan task 1): the file-level
    // record above stays the AGGREGATE with its unchanged shape, and every
    // consumer reading only the old keys sees byte-identical output.
    tests: perDeclaration.map((entry) => testScopeResult(filePath, declaredType, entry)),
  };
}

/**
 * Plan task 1 — one `TestScopeResult` per declaration site.
 *
 * Each site gets its OWN summary, evidence and gap: an assertion found in one
 * body is never attributed to a sibling, and a gap on one record never changes
 * another's basis. A declaration gap reports NO value with availability
 * UNKNOWN and the gap reason, so it can never be read as a zero-assertion
 * FAIL (KickOff:72 — never let a gap read as an absent value).
 */
function testScopeResult(filePath: string, declaredType: TestType, entry: DeclarationFindings): TestScopeResult {
  const { site, findings } = entry;
  const recognized = findings.filter((finding) => finding.form !== null);
  const unclassified = findings.filter((finding) => finding.form === null);
  const established = recognized.filter((finding) => finding.established);
  const gapped = site.gap !== 'none';

  // ponytail: same coverage rule as the file-level record, scoped to ONE
  // declaration; a gap forces PARTIAL/UNAVAILABLE instead of a scan verdict.
  const nonePresent = findings.length === 0;
  const allEstablished = unclassified.length === 0 && established.length === recognized.length;
  const coverageStatus = gapped
    ? isCapabilityGap(site.gap)
      ? CollectionStatus.PARTIAL
      : CollectionStatus.UNAVAILABLE
    : nonePresent || allEstablished
      ? CollectionStatus.COMPLETE
      : CollectionStatus.PARTIAL;

  const record = makeEvidenceRecord({
    type: EVIDENCE_ASSERTION_COUNT,
    // Gap declarations report NO value: a fabricated 0 would be exactly the
    // zero-assertion verdict basis for a body we never scanned.
    value: gapped ? undefined : established.length,
    availability: deriveAvailability(coverageStatus),
    provenance: Provenance.DIRECT,
    source: ANALYZER_ID,
    collector_version: COLLECTOR_VERSION,
    scope: ANALYSIS_SCOPE,
    coverage: coverage(coverageStatus),
  });
  const reason = gapped ? declarationGapReason(site) : coverageReason(unclassified, recognized, nonePresent, [site]);
  if (reason !== undefined) {
    record.reason = reason;
  }
  const first = findings[0];
  if (first !== undefined) {
    record.location = { file: filePath, line: first.line };
  }

  // Recognition completeness per declaration: a body we could not scan (not
  // an `it.todo`, whose body provably does not exist) is INCOMPLETE.
  const completeness =
    unclassified.length > 0 || isCapabilityGap(site.gap) ? Completeness.INCOMPLETE : Completeness.COMPLETE;

  const name = declarationName(site.declaration);
  return {
    test: {
      // Deterministic: file + declaration form + source line. No counters, no clock.
      id: `${filePath}#${name}@${site.line}`,
      name: site.name,
      line: site.line,
      declaration: name,
    },
    analysis: summary(AnalysisStatus.SUCCESS, completeness, declaredType),
    evidence: { [EVIDENCE_ASSERTION_COUNT]: record },
    declaration_gap: gapped ? declarationGapReason(site) : null,
  };
}

function coverageReason(
  unclassified: AssertionFinding[],
  recognized: AssertionFinding[],
  nonePresent: boolean,
  declarations: DeclarationSite[],
): string | undefined {
  const parts: string[] = [];
  if (!nonePresent) {
    // A completed scan that found nothing is a finding, not a gap — but it
    // still has to report any declaration we could not fully cover.
    if (unclassified.length > 0) {
      parts.push(
        `${unclassified.length} assertion-like construct(s) could not be classified: ` +
          unclassified.map((finding) => `${finding.syntax} — ${finding.reason}`).join('; '),
      );
    }
    const unestablished = recognized.filter((finding) => !finding.established);
    if (unestablished.length > 0) {
      parts.push(
        `${unestablished.length} of ${recognized.length} recognized assertion(s) have unestablished executability: ` +
          unestablished.map((finding) => `${finding.syntax} — ${finding.reason}`).join('; '),
      );
    }
  }
  // F — recognized vs not-fully-supported declaration counts, always reported
  // so no `it`/`test` form is silently omitted from the record.
  const declared = declarations.filter((site) => site.gap !== 'none');
  if (declared.length > 0) {
    parts.push(
      `${declarations.length} test declaration(s) recognized, ${declared.length} not fully supported: ` +
        declared.map((site) => `${site.syntax} — ${declarationGapReason(site)}`).join('; '),
    );
  }
  return parts.length > 0 ? parts.join(' | ') : undefined;
}

/* ------------------------------------------------------------------ *
 * AST walk
 * ------------------------------------------------------------------ */

/**
 * F — every `it`/`test` declaration in the file, in source order, including the
 * forms the collector does not fully support. The walk descends through all
 * nodes, so a declaration nested inside `describe` is found.
 *
 * The callee shape is peeled (`it.each(t)(name, fn)`, ``it.each`row`(name, fn)``,
 * `it.skipIf(c)(name, fn)`) so all of them land here. A chained callee is
 * skipped: in `it.each(t)(name, fn)` the OUTER call is the declaration, and
 * counting the inner `it.each(t)` too would report one test twice.
 */
function findTestDeclarations(sourceFile: ts.SourceFile, aliases: ReadonlyMap<string, string>): DeclarationSite[] {
  const sites: DeclarationSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && !isChainedCallee(node)) {
      const declaration = classifyTestDeclaration(node.expression, aliases);
      if (declaration !== null) {
        sites.push(declarationSite(sourceFile, node, declaration));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/** True when this call is only the callee half of a chained declaration. */
function isChainedCallee(node: ts.CallExpression): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

/**
 * E — the straight-line body, defined precisely.
 *
 * A test body is STRAIGHT-LINE when every statement it runs sits directly in
 * the body block, in source order, and nothing before it can divert control
 * flow. Concretely an assertion is straight-line when ALL of the following
 * hold:
 *
 *   1. it is a top-level statement of the test body (or the whole concise
 *      arrow body, `() => expect(x).toBe(1)`);
 *   2. no top-level `return` or `throw` precedes it in that block — the first
 *      such statement ends the straight-line region, and everything after it is
 *      unreachable;
 *   3. it is not nested inside a block or control-flow construct (`if`,
 *      `else`, loop, `try`/`catch`/`finally`, `switch`, `do`, labeled
 *      statement) — those may or may not run, and which is not establishable
 *      without control-flow analysis, which milestone-1 does not do;
 *   4. it is not inside a function nested in the body (arrow function, function
 *      expression or function declaration) — that is a callback;
 *   5. its enclosing declaration is a bare `it(name, fn)` / `test(name, fn)` —
 *      a modifier form (`each`, `skip`, `only`, ...) changes how often the body
 *      runs in ways milestone-1 does not model (F);
 *   6. it is not inside a NESTED declaration — a test declared in another test's
 *      body is its own scope and its own record, so its assertions are never
 *      counted for the outer test (plan task 7, hardening c).
 *
 * This is a syntactic shape test, not a dataflow analysis: no branch conditions,
 * loop trip counts or exception paths are evaluated. Anything failing a rule
 * above is still RECOGNIZED and reported; it is only `established` that it
 * loses. Presence alone never proves execution (KickOff:108-109).
 */
function scanTestBody(
  sourceFile: ts.SourceFile,
  body: ts.Node,
  declarationReason: string | undefined,
  declarations: ReadonlySet<ts.Node>,
  out: AssertionFinding[],
): void {
  if (ts.isBlock(body)) {
    // Rule 2 — first top-level return/throw ends the straight-line region. A
    // return nested in an `if` is conditional and proves nothing (rule 3).
    let haltAt = body.statements.length;
    body.statements.forEach((statement, index) => {
      if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
        haltAt = Math.min(haltAt, index);
      }
    });
    body.statements.forEach((statement, index) => {
      visit(statement, declarationReason ?? (index > haltAt ? REASON_AFTER_HALT : undefined));
    });
    return;
  }
  // Concise arrow body: () => expect(x).toBe(1)
  visit(body, declarationReason);

  /**
   * Carries the reason (if any) that everything below fails the definition
   * above. The OUTERMOST reason wins — a `return` above a callback is a
   * stronger statement about the assertion than the callback itself.
   */
  function visit(node: ts.Node, reason: string | undefined): void {
    // Rule 6 — declaration boundary: a finding belongs to AT MOST one
    // declaration. An `it` nested in a test body has its OWN site and its own
    // record, so scanning it here would count its assertions for the outer
    // test (plan task 7, hardening c).
    if (declarations.has(node)) {
      return;
    }
    const finding = describeAssertion(sourceFile, node, reason);
    if (finding !== null) {
      out.push(finding);
      return; // never descend into an assertion chain
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      // Rule 4 — a function nested inside the test body is a callback.
      ts.forEachChild(node, (child) => visit(child, reason ?? REASON_CALLBACK));
      return;
    }
    // Rules 3 — control flow may or may not run; `isBlock` catches the braced
    // bodies those constructs hang their statements on.
    if (isControlFlow(node)) {
      ts.forEachChild(node, (child) => visit(child, reason ?? REASON_NESTED_BLOCK));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, reason));
  }
}

/** Constructs whose body is conditional, looping or guarded — never straight-line. */
function isControlFlow(node: ts.Node): boolean {
  return (
    ts.isBlock(node) ||
    ts.isIfStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isTryStatement(node) ||
    ts.isLabeledStatement(node)
  );
}

function collectTestBodyFindings(
  sourceFile: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
): DeclarationFindings[] {
  const sites = findTestDeclarations(sourceFile, aliases);
  // Every declaration call in the file — a scan stops at these, so one finding
  // can belong to at most one declaration (plan task 7, hardening c).
  const declarations = new Set<ts.Node>(sites.map((site) => site.node));
  const perDeclaration: DeclarationFindings[] = [];
  for (const site of sites) {
    // Findings land in THIS site's own array — never in a shared one, so an
    // assertion in one declaration's body cannot be counted for a sibling.
    const findings: AssertionFinding[] = [];
    if (site.body !== null) {
      // Rule 5 — a modifier form gates every assertion in its body; the
      // conditional/aliased REPORTED forms gate the same way (they are the
      // same unsupported-form class, just named for the construct).
      const declarationReason =
        site.gap === 'unsupported-form' || site.gap === 'conditional' || site.gap === 'aliased'
          ? declarationGapReason(site)
          : undefined;
      scanTestBody(sourceFile, site.body, declarationReason, declarations, findings);
    }
    perDeclaration.push({ site, findings });
  }
  return perDeclaration;
}

function describeAssertion(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  executability: string | undefined,
): AssertionFinding | null {
  if (!ts.isCallExpression(node)) {
    return null;
  }

  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const form = classifyForm(node);
  if (form !== null) {
    return {
      form,
      established: executability === undefined,
      reason: executability ?? '',
      syntax: shortText(sourceFile, node),
      line,
    };
  }

  // expect(x)[matcher]() — the matcher name is computed, not resolvable here.
  if (ts.isElementAccessExpression(node.expression) && isExpectChain(node)) {
    return {
      form: null,
      established: false,
      reason: 'computed matcher cannot be resolved statically',
      syntax: shortText(sourceFile, node),
      line,
    };
  }

  // expect(x).<unsupported matcher>() — an expect chain we do not support.
  if (isExpectChain(node)) {
    return {
      form: null,
      established: false,
      reason: 'expect matcher is not one of the supported assertion forms',
      syntax: shortText(sourceFile, node),
      line,
    };
  }

  // assert.equal(x, y) — assertion API from outside the supported forms.
  const namespace = rootIdentifier(node);
  if (namespace !== null && UNSUPPORTED_ASSERTION_NAMESPACES.includes(namespace)) {
    return {
      form: null,
      established: false,
      reason: `'${namespace}' is not a supported assertion form`,
      syntax: shortText(sourceFile, node),
      line,
    };
  }

  // expectValidUser(user) — custom helper, unresolvable in `test-body` scope (A1).
  if (looksLikeCustomHelper(node)) {
    return {
      form: null,
      established: false,
      reason: 'custom assertion helper is out of the declared test-body scope',
      syntax: shortText(sourceFile, node),
      line,
    };
  }

  return null;
}

/**
 * Analysis envelope (plan task 2; SPEC:226-279, 364-402).
 *
 * status / completeness / evidence / rule results are four separate dimensions
 * (SPEC:366, guardrail). This module only declares the shapes — the collector
 * (task 3) produces them, the reporter (task 6) serializes them.
 */

import { EvidenceRecord } from './evidence';

export enum AnalysisStatus {
  /** Required steps ran and returned interpretable output; some evidence may still be unavailable. */
  SUCCESS = 'SUCCESS',
  /** Source, language, framework or capability outside supported scope. */
  UNSUPPORTED = 'UNSUPPORTED',
  /** A required step failed, or its output could not be interpreted. */
  FAILED = 'FAILED',
}

export enum Completeness {
  COMPLETE = 'COMPLETE',
  INCOMPLETE = 'INCOMPLETE',
  /** Concept of completeness does not apply, where explicitly justified. */
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

export enum TestType {
  UNIT = 'UNIT',
  COMPONENT = 'COMPONENT',
  INTEGRATION = 'INTEGRATION',
  CONTRACT = 'CONTRACT',
  E2E = 'E2E',
  /** Never silently inferred in milestone-1; unknown → INDETERMINATE (SPEC:475-479). */
  UNKNOWN = 'UNKNOWN',
}

/** How a test type was decided. Inferred classification is never authoritative (SPEC:458). */
export enum ClassificationSource {
  EXPLICIT = 'EXPLICIT',
  INFERRED = 'INFERRED',
  DEFAULT = 'DEFAULT',
}

export interface TestTypeAssignment {
  value: TestType;
  source: ClassificationSource;
}

/** The analyzed subject (SPEC:228-235). */
export interface AnalysisSubject {
  id: string;
  name: string;
  file: string;
  language: string;
  framework?: string;
  type?: TestType;
}

export interface AnalysisSummary {
  status: AnalysisStatus;
  completeness: Completeness;
  scope: string;
  test_type: TestTypeAssignment;
}

/** Named collector capabilities the caller could rely on (SPEC:395-399). */
export enum CapabilityStatus {
  AVAILABLE = 'AVAILABLE',
  PARTIAL = 'PARTIAL',
  UNAVAILABLE = 'UNAVAILABLE',
}

/**
 * Identity of one test declaration site (plan task 1; per-test scope).
 *
 * One test = one `it`/`test` declaration in source order. The id is
 * deterministic — `<file>#<declaration>@<line>` — with no counters, no clock
 * and no randomness, so two runs over the same file produce identical ids.
 */
export interface TestIdentity {
  /** `<file>#<declaration>@<line>`, e.g. `sample.test.ts#it@2`. */
  id: string;
  /** Test name as written in the declaration. */
  name: string;
  /** 1-based source line of the declaration call. */
  line: number;
  /** Source form, e.g. 'it' or 'it.each'. */
  declaration: string;
}

/**
 * One declaration's slice of the analysis: its own summary, its own evidence
 * and its own declaration gap. The four dimensions stay separate here exactly
 * as at file scope (SPEC:366), and an assertion in one declaration's body is
 * never attributed to another.
 */
export interface TestScopeResult {
  test: TestIdentity;
  analysis: AnalysisSummary;
  evidence: Record<string, EvidenceRecord>;
  /** Why this declaration was not fully analyzed; null when fully scanned. */
  declaration_gap: string | null;
}

/** Top-level envelope handed from collector to engine to reporter. */
export interface AnalysisOutput {
  subject: AnalysisSubject;
  analysis: AnalysisSummary;
  evidence: Record<string, EvidenceRecord>;
  capabilities: Record<string, CapabilityStatus>;
  /**
   * Per-declaration results in source order (plan task 1). Optional: absent
   * means subject-level scope only, so existing consumers keep their exact
   * shape; the file-level `evidence` above stays the aggregate.
   *
   * ABSENT and EMPTY are different states (WP1.1): `[]` is a SUPPLIED collection
   * of zero records — the scan ran and located no declaration — so it yields zero
   * test evaluations and no verdict. Only the absent field takes the subject-level
   * fallback, so a file declaring no test never reports a phantom per-test finding.
   */
  tests?: TestScopeResult[];
}

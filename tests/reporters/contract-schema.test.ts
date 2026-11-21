/**
 * Reporting contract schema tests (WP4).
 *
 * The published schema describes the SHIPPED schemaVersion 0.5 wire shape. These
 * tests prove three things: the existing golden reports validate unchanged, the
 * representative shapes (legacy fallback, deprecated rule, file-level mutation)
 * validate, and the JSON-only no-adapter envelope validates against its own
 * $def while remaining distinguishable from a normal report. Unknown-key
 * tolerance is asserted explicitly (ADR-042).
 *
 * `ajv` is present transitively through the Jest/Stryker toolchain; this test
 * deliberately does not add a dependency.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv2020, { type AnySchemaObject } from 'ajv/dist/2020';

type Validator = ((data: unknown) => boolean) & { errors?: unknown };

const SCHEMA_ID = 'https://checktest.dev/schemas/checktest-report.schema.json';
const SCHEMA = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'schemas', 'checktest-report.schema.json'), 'utf8'),
) as AnySchemaObject;

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(SCHEMA);

function validator(ref: string): Validator {
  const validate = ajv.getSchema(ref);
  if (validate === undefined) {
    throw new Error(`schema not found: ${ref}`);
  }
  return validate as unknown as Validator;
}

function expectValid(validate: Validator, value: unknown): void {
  const valid = validate(value);
  expect(valid ? null : validate.errors).toBeNull();
}

const validateReport = validator(SCHEMA_ID);
const validateNoAdapter = validator(`${SCHEMA_ID}#/$defs/noAdapterEnvelope`);

const FIXTURES = join(__dirname, 'fixtures');
const CONTRACT_FIXTURES = join(__dirname, 'contract-fixtures');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const GOLDENS = ['case-24', 'case-25', 'case-26', 'k15-fail'] as const;

describe('reporting contract schema — existing goldens', () => {
  for (const name of GOLDENS) {
    it(`${name}.json validates and its bytes are unchanged`, () => {
      const raw = readFileSync(join(FIXTURES, `${name}.json`), 'utf8');
      // Byte-identity guard: the on-disk fixture IS this parsed report
      // re-serialized, so the schema validates the bytes the reporter emits,
      // not a rewritten copy.
      expect(JSON.stringify(readJson(join(FIXTURES, `${name}.json`)), null, 2)).toBe(raw);
      expectValid(validateReport, JSON.parse(raw));
    });
  }
});

const REPRESENTATIVE = ['legacy-subject-level', 'deprecated-rule', 'mutation-file-level'] as const;

describe('reporting contract schema — representative shapes', () => {
  for (const name of REPRESENTATIVE) {
    it(`${name}.json validates`, () => {
      expectValid(validateReport, readJson(join(CONTRACT_FIXTURES, `${name}.json`)));
    });
  }
});

/** Mirrors the CLI envelope at src/cli.ts:686-701, field for field. */
const NO_ADAPTER_ENVELOPE = {
  kind: 'check',
  schemaVersion: '0.5',
  analysisStatus: 'UNSUPPORTED',
  evaluationStatus: 'FAILED',
  completeness: 'NOT_APPLICABLE',
  reasonCode: 'NO_ADAPTER_MATCHED',
  reason:
    "no adapter matched for sample.test.xyz; run 'checktest doctor --test sample.test.xyz' to inspect dispatch, or force an adapter with --adapter <id>",
  test: { file: 'sample.test.xyz' },
  ruleResults: [],
  testResults: [],
  summary: { total: 0, pass: 0, fail: 0, indeterminate: 0, not_applicable: 0, failed: 0 },
};

describe('reporting contract schema — no-adapter envelope', () => {
  it('validates against $defs.noAdapterEnvelope', () => {
    expectValid(validateNoAdapter, NO_ADAPTER_ENVELOPE);
  });

  it('is not a normal check report', () => {
    expect(validateReport(NO_ADAPTER_ENVELOPE)).toBe(false);
  });

  it('does not accept a normal report (its const fields do not hold)', () => {
    expect(validateNoAdapter(readJson(join(FIXTURES, 'case-24.json')))).toBe(false);
  });
});

describe('reporting contract schema — tolerance and required keys', () => {
  it('accepts unknown keys at every level (ADR-042 unknown-key tolerance)', () => {
    const report = readJson(join(FIXTURES, 'case-24.json')) as {
      futureEnvelopeField?: unknown;
      testResults: Array<Record<string, unknown>>;
      evidence: Record<string, Record<string, unknown>>;
    };
    report.futureEnvelopeField = { any: 'value' };
    report.testResults[0].futurePerTestField = true;
    report.evidence.assertion_count.futureEvidenceField = 42;
    expectValid(validateReport, report);
  });

  it('rejects a report missing a required envelope key', () => {
    const report = readJson(join(FIXTURES, 'case-24.json')) as Record<string, unknown>;
    delete report.summary;
    expect(validateReport(report)).toBe(false);
  });
});

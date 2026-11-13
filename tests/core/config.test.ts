import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';

import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { CT_MUT_001 } from '../../src/rules/ct-mut-001';
import { UsageError } from '../../src/cli';
import { applyConfigToRule, loadConfig, parseConfig } from '../../src/core/config';

const KNOWN_RULE_IDS = ['CT-COV-001', 'CT-INT-001', 'CT-INT-003', 'CT-INT-004', 'CT-MUT-001'];

const REGISTERED_RULES = [CT_COV_001, CT_INT_001, CT_INT_003, CT_INT_004, CT_MUT_001];

describe('config parsing', () => {
  it('parses a valid config', () => {
    const cfg = parseConfig(
      JSON.stringify({
        rules: {
          'CT-INT-001': {
            enabled: true,
            thresholds: { passAtLeast: 2, failAtMost: 0 },
            severity: 'warning',
          },
        },
      }),
      KNOWN_RULE_IDS,
    );
    expect(cfg.rules['CT-INT-001']).toEqual({
      enabled: true,
      thresholds: { passAtLeast: 2, failAtMost: 0 },
      severity: 'warning',
    });
  });

  it('rejects an unknown top-level key', () => {
    expect(() => parseConfig(JSON.stringify({ foo: {} }), KNOWN_RULE_IDS)).toThrow(UsageError);
  });

  it('rejects an unknown rule id', () => {
    expect(() => parseConfig(JSON.stringify({ rules: { 'CT-NOPE-001': {} } }), KNOWN_RULE_IDS)).toThrow(UsageError);
  });

  it('rejects a non-numeric threshold', () => {
    expect(() =>
      parseConfig(JSON.stringify({ rules: { 'CT-INT-001': { thresholds: { passAtLeast: 'x' } } } }), KNOWN_RULE_IDS),
    ).toThrow(UsageError);
  });

  it('rejects a malformed severity', () => {
    expect(() =>
      parseConfig(JSON.stringify({ rules: { 'CT-INT-001': { severity: 'blocker' } } }), KNOWN_RULE_IDS),
    ).toThrow(UsageError);
  });

  it('rejects non-JSON input', () => {
    expect(() => parseConfig('{not json', KNOWN_RULE_IDS)).toThrow(UsageError);
  });

  it('rejects thresholds with invalid ordering', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ rules: { 'CT-INT-001': { thresholds: { passAtLeast: 0, failAtMost: 1 } } } }),
        KNOWN_RULE_IDS,
      ),
    ).toThrow(UsageError);
  });

  it('rejects a malformed enabled value', () => {
    expect(() => parseConfig(JSON.stringify({ rules: { 'CT-INT-001': { enabled: 'yes' } } }), KNOWN_RULE_IDS)).toThrow(
      UsageError,
    );
  });

  it('rejects a non-object config', () => {
    expect(() => parseConfig('42', KNOWN_RULE_IDS)).toThrow(UsageError);
  });

  it('rejects a missing config file', () => {
    expect(() => loadConfig(join(tmpdir(), 'does-not-exist-checktest-config.json'), KNOWN_RULE_IDS)).toThrow(
      UsageError,
    );
  });

  it('reads a config file from disk', () => {
    const dir = join(tmpdir(), 'checktest-config-ok');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'checktest.config.json');
    writeFileSync(p, JSON.stringify({ rules: { 'CT-INT-001': { severity: 'info' } } }), 'utf8');
    const cfg = loadConfig(p, KNOWN_RULE_IDS);
    expect(cfg.rules['CT-INT-001'].severity).toBe('info');
  });
});

describe('applyConfigToRule', () => {
  it('returns a new rule object with overrides applied', () => {
    const configured = applyConfigToRule(CT_INT_001, {
      enabled: true,
      thresholds: { passAtLeast: 2, failAtMost: 0 },
      severity: 'warning',
    });
    expect(configured).not.toBe(CT_INT_001);
    expect(configured.evaluation.pass_at_least).toBe(2);
    expect(configured.evaluation.fail_at_most).toBe(0);
    expect(configured.severity).toBe('warning');
  });

  it('does not mutate the original rule', () => {
    const beforePa = CT_INT_001.evaluation.pass_at_least;
    const beforeSev = CT_INT_001.severity;
    applyConfigToRule(CT_INT_001, {
      thresholds: { passAtLeast: 9, failAtMost: 8 },
      severity: 'info',
    });
    expect(CT_INT_001.evaluation.pass_at_least).toBe(beforePa);
    expect(CT_INT_001.severity).toBe(beforeSev);
  });

  it('leaves omitted override fields unchanged', () => {
    const configured = applyConfigToRule(CT_INT_001, { severity: 'info' });
    expect(configured.evaluation.pass_at_least).toBe(CT_INT_001.evaluation.pass_at_least);
    expect(configured.evaluation.fail_at_most).toBe(CT_INT_001.evaluation.fail_at_most);
    expect(configured.severity).toBe('info');
  });

  it('rejects thresholds that violate ordering', () => {
    expect(() => applyConfigToRule(CT_INT_001, { thresholds: { passAtLeast: 0, failAtMost: 1 } })).toThrow(UsageError);
  });

  for (const rule of REGISTERED_RULES) {
    it(`preserves evidence-policy fields for ${rule.id} after config application`, () => {
      const configured = applyConfigToRule(rule, {
        thresholds: { passAtLeast: rule.evaluation.pass_at_least + 1, failAtMost: rule.evaluation.fail_at_most },
        severity: 'info',
      });
      // Only evaluation.pass_at_least/fail_at_most + severity may change.
      expect(configured.id).toBe(rule.id);
      expect(configured.name).toBe(rule.name);
      expect(configured.category).toBe(rule.category);
      expect(configured.description).toBe(rule.description);
      expect(configured.applies_to).toEqual(rule.applies_to);
      expect(configured.required_evidence).toEqual(rule.required_evidence);
      expect(configured.analysis_scope).toBe(rule.analysis_scope);
      expect(configured.minimum_evidence_completeness).toBe(rule.minimum_evidence_completeness);
      expect(configured.unknown_evidence_policy).toBe(rule.unknown_evidence_policy);
      expect(configured.conflicting_evidence_policy).toBe(rule.conflicting_evidence_policy);
      expect(configured.evaluation.metric).toBe(rule.evaluation.metric);
      expect(configured.status).toBe(rule.status);
      // severity changed to info per override.
      expect(configured.severity).toBe('info');
      // metric unchanged (explicitly part of the immutability contract).
      expect(configured.evaluation.metric).toBe(rule.evaluation.metric);
    });
  }

  it('handles undefined overrides as identity copy', () => {
    const configured = applyConfigToRule(CT_INT_001, undefined);
    expect(configured).not.toBe(CT_INT_001);
    expect(configured).toEqual(CT_INT_001);
  });
});

/**
 * Config layer (SP4.1, task 18). Explicit --config path only — no implicit
 * discovery. The config may change per-rule thresholds, severity and enabled
 * flags; it must NEVER change evidence semantics (roadmap:1213-1215).
 */
import { readFileSync } from 'fs';

import { RuleMetadata } from './rule';

export class UsageError extends Error {}

export interface ConfigThresholds {
  passAtLeast?: number;
  failAtMost?: number;
}

export interface ConfigRuleOverride {
  enabled?: boolean;
  thresholds?: ConfigThresholds;
  severity?: 'error' | 'warning' | 'info';
}

export interface CheckTestConfig {
  rules: Record<string, ConfigRuleOverride>;
  /** Declared revision the coverage report was produced against (input
   * selection, NOT evidence semantics — §21 of the spec). */
  sourceRevision?: string;
}

const RULE_OVERRIDE_KEYS = ['enabled', 'thresholds', 'severity'] as const;
const THRESHOLD_KEYS = ['passAtLeast', 'failAtMost'] as const;
const VALID_SEVERITIES = ['error', 'warning', 'info'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseConfig(
  raw: string,
  knownRuleIds: readonly string[],
  localDecisionRuleIds: readonly string[] = [],
  thresholdsInertRuleIds: readonly string[] = [],
): CheckTestConfig {
  const parsed = parseJsonTopLevel(raw);
  const rules = readRulesSection(parsed);
  const known = new Set(knownRuleIds);
  const result = parseAllRules(rules, known, localDecisionRuleIds, thresholdsInertRuleIds);
  const config: CheckTestConfig = { rules: result };
  if (parsed.sourceRevision !== undefined) {
    config.sourceRevision = parsed.sourceRevision as string;
  }
  return config;
}

function parseJsonTopLevel(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError('invalid --config: file is not valid JSON');
  }
  if (!isRecord(parsed)) {
    throw new UsageError('invalid --config: top level must be a JSON object');
  }
  for (const key of Object.keys(parsed)) {
    if (key !== 'rules' && key !== 'sourceRevision') {
      throw new UsageError(`invalid --config: unknown top-level key '${key}'`);
    }
  }
  if (parsed.sourceRevision !== undefined && typeof parsed.sourceRevision !== 'string') {
    throw new UsageError(`invalid --config: 'sourceRevision' must be a string`);
  }
  return parsed;
}

function readRulesSection(parsed: Record<string, unknown>): Record<string, unknown> {
  const rulesRaw = parsed.rules;
  if (rulesRaw === undefined) return {};
  if (!isRecord(rulesRaw)) {
    throw new UsageError('invalid --config: "rules" must be an object');
  }
  return rulesRaw;
}

function parseAllRules(
  rules: Record<string, unknown>,
  known: Set<string>,
  localDecisionIds: readonly string[] = [],
  thresholdsInertIds: readonly string[] = [],
): Record<string, ConfigRuleOverride> {
  const result: Record<string, ConfigRuleOverride> = {};
  for (const [ruleId, rawOverride] of Object.entries(rules)) {
    if (!known.has(ruleId)) {
      throw new UsageError(`invalid --config: unknown rule id '${ruleId}'`);
    }
    result[ruleId] = parseRuleOverride(ruleId, rawOverride, localDecisionIds, thresholdsInertIds);
  }
  return result;
}

function parseRuleOverride(
  ruleId: string,
  rawOverride: unknown,
  localDecisionIds: readonly string[] = [],
  thresholdsInertIds: readonly string[] = [],
): ConfigRuleOverride {
  if (!isRecord(rawOverride)) {
    throw new UsageError(`invalid --config: override for '${ruleId}' must be an object`);
  }
  validateOverrideKeys(ruleId, rawOverride);
  if (rawOverride.thresholds !== undefined) {
    if (localDecisionIds.includes(ruleId)) {
      throw new UsageError(`invalid --config: 'thresholds' is not configurable for local-decision rule '${ruleId}'`);
    }
    if (thresholdsInertIds.includes(ruleId)) {
      throw new UsageError(
        `invalid --config: thresholds are not configurable for rule '${ruleId}': its thresholds are inert`,
      );
    }
  }
  const override: ConfigRuleOverride = {};
  if (rawOverride.enabled !== undefined) {
    override.enabled = parseEnabled(ruleId, rawOverride.enabled);
  }
  if (rawOverride.thresholds !== undefined) {
    override.thresholds = parseThresholds(ruleId, rawOverride.thresholds);
  }
  if (rawOverride.severity !== undefined) {
    override.severity = parseSeverity(ruleId, rawOverride.severity);
  }
  return override;
}

function validateOverrideKeys(ruleId: string, rawOverride: Record<string, unknown>): void {
  for (const key of Object.keys(rawOverride)) {
    if (!RULE_OVERRIDE_KEYS.includes(key as (typeof RULE_OVERRIDE_KEYS)[number])) {
      throw new UsageError(`invalid --config: unknown key '${key}' for rule '${ruleId}'`);
    }
  }
}

function parseEnabled(ruleId: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new UsageError(`invalid --config: 'enabled' for '${ruleId}' must be a boolean`);
  }
  return value;
}

function parseSeverity(ruleId: string, value: unknown): ConfigRuleOverride['severity'] {
  if (typeof value !== 'string' || !VALID_SEVERITIES.includes(value as any)) {
    throw new UsageError(`invalid --config: 'severity' for '${ruleId}' must be error|warning|info`);
  }
  return value as ConfigRuleOverride['severity'];
}

function parseThresholds(ruleId: string, thresholdsRaw: unknown): ConfigThresholds {
  if (!isRecord(thresholdsRaw)) {
    throw new UsageError(`invalid --config: 'thresholds' for '${ruleId}' must be an object`);
  }
  validateThresholdKeys(ruleId, thresholdsRaw);
  const thresholds: ConfigThresholds = {};
  if (thresholdsRaw.passAtLeast !== undefined) {
    thresholds.passAtLeast = parseFiniteThreshold(ruleId, 'passAtLeast', thresholdsRaw.passAtLeast);
  }
  if (thresholdsRaw.failAtMost !== undefined) {
    thresholds.failAtMost = parseFiniteThreshold(ruleId, 'failAtMost', thresholdsRaw.failAtMost);
  }
  assertThresholdOrder(ruleId, thresholds);
  return thresholds;
}

function validateThresholdKeys(ruleId: string, thresholdsRaw: Record<string, unknown>): void {
  for (const key of Object.keys(thresholdsRaw)) {
    if (!THRESHOLD_KEYS.includes(key as (typeof THRESHOLD_KEYS)[number])) {
      throw new UsageError(`invalid --config: unknown threshold '${key}' for rule '${ruleId}'`);
    }
  }
}

function parseFiniteThreshold(ruleId: string, field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UsageError(`invalid --config: '${field}' for '${ruleId}' must be a finite number`);
  }
  return value;
}

function assertThresholdOrder(ruleId: string, thresholds: ConfigThresholds): void {
  if (
    thresholds.passAtLeast !== undefined &&
    thresholds.failAtMost !== undefined &&
    !(thresholds.passAtLeast > thresholds.failAtMost)
  ) {
    throw new UsageError(`invalid --config: thresholds for '${ruleId}' must have passAtLeast > failAtMost`);
  }
}

export function loadConfig(
  path: string,
  knownRuleIds: readonly string[],
  localDecisionRuleIds: readonly string[] = [],
  thresholdsInertRuleIds: readonly string[] = [],
): CheckTestConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`missing or unreadable --config '${path}'`);
  }
  return parseConfig(raw, knownRuleIds, localDecisionRuleIds, thresholdsInertRuleIds);
}

export function applyConfigToRule(rule: RuleMetadata, overrides?: ConfigRuleOverride): RuleMetadata {
  if (overrides === undefined) {
    return { ...rule, evaluation: { ...rule.evaluation } };
  }
  if (overrides.enabled !== undefined && typeof overrides.enabled !== 'boolean') {
    throw new UsageError(`invalid config overrides for '${rule.id}': enabled must be a boolean`);
  }
  if (overrides.severity !== undefined && !VALID_SEVERITIES.includes(overrides.severity as any)) {
    throw new UsageError(`invalid config overrides for '${rule.id}': severity must be error|warning|info`);
  }
  const thresholds = overrides.thresholds ?? {};
  for (const k of Object.keys(thresholds)) {
    if (!THRESHOLD_KEYS.includes(k as (typeof THRESHOLD_KEYS)[number])) {
      throw new UsageError(`invalid config overrides for '${rule.id}': unknown threshold '${k}'`);
    }
  }
  let pass = rule.evaluation.pass_at_least;
  let fail = rule.evaluation.fail_at_most;
  if (thresholds.passAtLeast !== undefined) {
    if (typeof thresholds.passAtLeast !== 'number' || !Number.isFinite(thresholds.passAtLeast)) {
      throw new UsageError(`invalid config overrides for '${rule.id}': passAtLeast must be finite`);
    }
    pass = thresholds.passAtLeast;
  }
  if (thresholds.failAtMost !== undefined) {
    if (typeof thresholds.failAtMost !== 'number' || !Number.isFinite(thresholds.failAtMost)) {
      throw new UsageError(`invalid config overrides for '${rule.id}': failAtMost must be finite`);
    }
    fail = thresholds.failAtMost;
  }
  if (!(pass > fail)) {
    throw new UsageError(
      `invalid config overrides for '${rule.id}': passAtLeast (${pass}) must be greater than failAtMost (${fail})`,
    );
  }
  const nextSeverity = overrides.severity === undefined ? rule.severity : overrides.severity;
  return {
    ...rule,
    evaluation: { ...rule.evaluation, pass_at_least: pass, fail_at_most: fail },
    severity: nextSeverity,
  };
}

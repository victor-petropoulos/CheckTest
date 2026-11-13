import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';

import { UsageError } from '../../src/cli';
import { loadConfig, parseConfig } from '../../src/core/config';

const KNOWN_RULE_IDS = ['CT-COV-001', 'CT-INT-001', 'CT-INT-003', 'CT-INT-004', 'CT-MUT-001'];

describe('config top-level sourceRevision (TDD RED)', () => {
  it('parses a top-level sourceRevision string', () => {
    const cfg = parseConfig(JSON.stringify({ sourceRevision: 'rev-x', rules: {} }), KNOWN_RULE_IDS);
    expect((cfg as any).sourceRevision).toBe('rev-x');
  });

  it('rejects a non-string sourceRevision', () => {
    expect(() => parseConfig(JSON.stringify({ sourceRevision: 42, rules: {} }), KNOWN_RULE_IDS)).toThrow(UsageError);
  });

  it('still rejects a truly unknown top-level key', () => {
    expect(() => parseConfig(JSON.stringify({ foo: {} }), KNOWN_RULE_IDS)).toThrow(UsageError);
  });

  it('reads sourceRevision from a config file on disk', () => {
    const dir = join(tmpdir(), 'checktest-config-sr');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'checktest.config.json');
    writeFileSync(p, JSON.stringify({ sourceRevision: 'rev-disk', rules: {} }), 'utf8');
    const cfg = loadConfig(p, KNOWN_RULE_IDS);
    expect((cfg as any).sourceRevision).toBe('rev-disk');
  });
});

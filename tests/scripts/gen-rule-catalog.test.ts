/**
 * UNIT 3 generator checks: idempotence, prose preservation, metadata fidelity,
 * and registration drift vs the production CLI (src/cli.ts main()).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BEGIN_MARKER,
  END_MARKER,
  PRODUCTION_RULES,
  registerProductionRules,
  renderGeneratedBlock,
  replaceGeneratedRegion,
} from '../../scripts/gen-rule-catalog';
import { allRules } from '../../src/rules/registry';

const catalogPath = join(__dirname, '..', '..', 'docs', 'rules', 'catalog.md');
const catalog = readFileSync(catalogPath, 'utf8');

function stripGenerated(doc: string): string {
  const begin = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (begin === -1 || end === -1) {
    return doc;
  }
  return doc.slice(0, begin) + doc.slice(end + END_MARKER.length);
}

describe('gen-rule-catalog', () => {
  it('is idempotent and preserves hand-written prose', () => {
    const block = renderGeneratedBlock(PRODUCTION_RULES);
    const once = replaceGeneratedRegion(catalog, block);
    const twice = replaceGeneratedRegion(once, renderGeneratedBlock(PRODUCTION_RULES));
    expect(twice).toBe(once);
    expect(stripGenerated(once)).toBe(stripGenerated(catalog));
  });

  it('renders every production rule metadata field into the tables', () => {
    registerProductionRules();
    const rules = allRules();
    expect(rules.map((rule) => rule.id)).toEqual(PRODUCTION_RULES.map((rule) => rule.id));
    const block = renderGeneratedBlock(rules);
    for (const rule of rules) {
      expect(block).toContain(`### ${rule.id} — ${rule.name}`);
      expect(block).toContain(rule.description);
      expect(block).toContain(rule.required_evidence.join('`, `'));
      expect(block).toContain(`metric \`${rule.evaluation.metric}\``);
      expect(block).toContain(rule.minimum_evidence_completeness);
      expect(block).toContain(rule.severity);
      expect(block).toContain(rule.status);
      expect(rule.rationale).toBeDefined();
      expect(block).toContain(rule.rationale as string);
      expect(rule.limitations).toBeDefined();
      expect(block).toContain(rule.limitations as string);
      expect(rule.docsUrl).toBeDefined();
      expect(block).toContain(rule.docsUrl as string);
    }
    // The unregistered stub must never leak into the generated tables.
    expect(block).not.toContain('CT-DEMO-001');
  });

  it('matches the checked-in catalog byte-for-byte (drift gate)', () => {
    // The checked-in generated region must equal the generator's output; this
    // also pins byte-parity with the repo's prettier markdown table style.
    expect(replaceGeneratedRegion(catalog, renderGeneratedBlock(PRODUCTION_RULES))).toBe(catalog);
  });

  it('registers exactly the production CLI set (drift guard)', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      let cliIds: string[] = [];
      // Fresh module registry so only main()'s own registrations are visible.
      jest.isolateModules(() => {
        const cli = require('../../src/cli') as typeof import('../../src/cli');
        const registry = require('../../src/rules/registry') as typeof import('../../src/rules/registry');
        // explain dispatches after registration and before parseArgs (no --test needed).
        expect(cli.main(['explain', '--rule', 'CT-INT-001', '--json'])).toBe(0);
        cliIds = registry.allRules().map((rule) => rule.id);
      });
      expect(PRODUCTION_RULES.map((rule) => rule.id)).toEqual(cliIds);
    } finally {
      stdout.mockRestore();
    }
  });
});

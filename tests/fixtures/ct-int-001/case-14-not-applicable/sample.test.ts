// Case 14 — genuinely not applicable (A2 OPTION A).
// Plan §4 row 14: COMPONENT / SUCCESS / COMPLETE / N/A.
//
// CT-INT-001 applies to all five concrete types, so it can NEVER report N/A.
// This fixture therefore evaluates the CT-DEMO-001 stub (applies_to: [UNIT])
// against a COMPONENT test. The evidence collected here is perfectly good —
// it would PASS under CT-INT-001 — so the N/A verdict proves the applicability
// guard runs FIRST and short-circuits everything after it (SPEC:472-473).
import { expect, it } from '@jest/globals';

it('renders a component', () => {
  expect({ id: 'widget-1' }).toMatchSnapshot();
});

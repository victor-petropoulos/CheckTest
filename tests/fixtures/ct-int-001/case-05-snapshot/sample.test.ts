// Case 05 — snapshot assertion (`toMatchSnapshot`).
// Plan §4 row 5: UNIT / SUCCESS / COMPLETE / assertion_count 1 KNOWN / PASS.
import { expect, it } from '@jest/globals';

it('renders a stable widget', () => {
  expect({ title: 'checktest' }).toMatchSnapshot();
});

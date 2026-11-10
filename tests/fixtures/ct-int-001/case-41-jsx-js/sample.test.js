// Case 41 — JSX in a .js test file (SP4 decision B).
// Exercises the JSX sniff -> ScriptKind.JSX parse path.
import { expect, it } from '@jest/globals';

const x = <div>hello</div>;

it('renders', () => {
  expect(x).toBeTruthy();
});

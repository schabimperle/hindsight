// Computes a fixture with the TS core and compares it with an oracle output.
// Usage: npm run compare -- <fixture.json> <expected.json>
import { readFileSync } from 'node:fs';
import { compareRuns } from '../src/core/compare';
import { run } from '../src/core/report';
import type { Fixture, RunOutput } from '../src/core/types';

const [fixturePath, expectedPath] = process.argv.slice(2);
if (!fixturePath || !expectedPath) {
  console.error('Usage: npm run compare -- <fixture.json> <expected.json>');
  process.exit(2);
}
const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
const want = JSON.parse(readFileSync(expectedPath, 'utf8')) as RunOutput;
const got = run(fx);
const diffs = compareRuns(got, want);
const names = want.variants.length;
if (diffs.length === 0) {
  console.log(`OK: ${names} variants${want.actual ? ' + actual' : ''} match the oracle.`);
} else {
  console.log(`${diffs.length} difference(s):`);
  for (const d of diffs) console.log(`  ${d}`);
  process.exit(1);
}

// node tests/run.js  — headless test run, exits non-zero on failure.
import { summary } from './tests.js';

const s = summary();
for (const r of s.results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : '\n         ' + r.msg}`);
}
console.log('');
if (s.cadence) console.log(`cadence:    ${s.cadence}`);
if (s.panicum) console.log(`switchgrass:${s.panicum} (own threshold)`);
if (s.fullRound) console.log(`full round: ${s.fullRound.toFixed(0)} gal (nursery table says 197)`);
console.log(`\n${s.pass}/${s.total} passed`);
process.exit(s.fail ? 1 : 0);

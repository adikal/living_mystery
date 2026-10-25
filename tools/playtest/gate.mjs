// The scripted-player gate for one case file: prints {"ok", "problems", ...} as JSON (publish.py runs it before writing).
//   node tools/playtest/gate.mjs <case.json>
import {scriptedChecks} from './scripted.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/playtest/gate.mjs <case.json>'); process.exit(2); }
const out = await scriptedChecks(file);
process.stdout.write(JSON.stringify(out) + '\n');

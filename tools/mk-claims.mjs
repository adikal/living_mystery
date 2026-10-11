#!/usr/bin/env node
// Claims (dist/mk/claims.mjs) over stdin, for cross-checks with the Python twin and the Z3 reference.
// Input: {"case": {...}, "sets": [[sign ids], ...]} -> output: {"truth": {sid: true|false|null},
// "sets": [{"survivors": [...], "consistent": bool}, ...]}. Each set is taken as the trusted claims.
import {readFileSync} from 'node:fs';
import {claimOf, history, truthOf, survivorsOf, consistent, travelTable} from '../dist/mk/claims.mjs';

const {case: c, sets} = JSON.parse(readFileSync(0, 'utf8'));
const tt = travelTable(c), H = history(c, tt), signs = Object.fromEntries(c.signs.map(s => [s.id, s]));
const claims = ids => ids.filter(id => claimOf(signs[id])).sort().map(id => [id, claimOf(signs[id])]);
const truth = Object.fromEntries(c.signs.filter(s => claimOf(s)).map(s => [s.id, truthOf(c, H, claimOf(s))]));
process.stdout.write(JSON.stringify({truth, sets: sets.map(ids => ({survivors: survivorsOf(c, claims(ids), tt), consistent: consistent(c, claims(ids), tt)}))}));

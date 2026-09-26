#!/usr/bin/env node
// Certify mystery-kernel case files with the JS kernel (the single source of truth for sign semantics).
// Usage: node tools/mk-certify.mjs case.json [more.json ...]   -> JSON array of reports on stdout
//        node tools/mk-certify.mjs -                            -> read one case from stdin
import {readFileSync} from 'node:fs';
import {certify, summarize} from '../dist/mk/kernel.mjs';

const args = process.argv.slice(2);
if (!args.length) { console.error('usage: mk-certify.mjs case.json [...] | -'); process.exit(2); }
const read = p => JSON.parse(p === '-' ? readFileSync(0, 'utf8') : readFileSync(p, 'utf8'));
const out = args.map(p => {
  try { return {file: p, ...summarize(certify(read(p)))}; }
  catch (e) { return {file: p, ok: false, errors: [`crashed: ${e.message}`]}; }
});
process.stdout.write(JSON.stringify(args.length === 1 && args[0] === '-' ? out[0] : out));

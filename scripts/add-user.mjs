#!/usr/bin/env node
// Creates a user with a personal access code.
// Usage: npm run user:add -- "Name" [--limit 15] [--remote]
// The code is printed once and only its hash is stored: keep it safe.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LENGTH = 20;

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex === -1 ? 15 : Number(args[limitIndex + 1]);
const name = args.find((arg, index) => !arg.startsWith('--') && index !== limitIndex + 1)?.trim();

if (!name || !Number.isInteger(limit) || limit < 0) {
  console.error('Usage: npm run user:add -- "Name" [--limit 15] [--remote]');
  process.exit(1);
}

const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const codeHash = createHash('sha256').update(code).digest('hex');
const sqlName = name.replaceAll("'", "''");

execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'aitool',
    remote ? '--remote' : '--local',
    '--command',
    `INSERT INTO users (name, code_hash, daily_message_limit) VALUES ('${sqlName}', '${codeHash}', ${limit});`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

const formatted = code.match(/.{5}/g).join('-');
console.log(`User "${name}" created (${remote ? 'remote' : 'local'} database, ${limit} messages/day).`);
console.log(`Access code: ${formatted}`);

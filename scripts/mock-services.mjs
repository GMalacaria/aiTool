#!/usr/bin/env node
// Local stand-ins for the external services, for development without real
// credentials. Never use outside localhost. See .dev.vars.example.
//
// Model (OpenAI-compatible Chat Completions) — OPENAI_BASE_URL=http://127.0.0.1:8788/v1
// - Draft calls echo the question. If the question contains "lusinga", the
//   draft starts with a compliment so the review pass has something to fix.
// - Review calls answer "OK", or strip the compliment from the draft.
// - A question containing "errore429" makes the mock answer HTTP 429.
// - Use http://127.0.0.1:8788/down/v1 as a base URL to simulate a provider out of quota,
//   e.g. OPENAI_BASE_URL=.../down/v1 with GROQ_BASE_URL=.../v1 to test the fallback.
//
// Image model (Gemini generateContent) — GEMINI_IMAGE_BASE_URL=http://127.0.0.1:8788/v1beta, GEMINI_IMAGE_API_KEY=any
// - Returns a coloured PNG derived from the prompt; a prompt containing "BLOCKED" returns no picture.
//
// Google sign-in — GOOGLE_AUTH_URL=http://127.0.0.1:8788/oauth/authorize
//                  GOOGLE_TOKEN_URL=http://127.0.0.1:8788/oauth/token
// - The authorize page asks which fake account to sign in with.
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8788);
const COMPLIMENT = 'Ottima domanda! ';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const base64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function chatCompletion(res, raw, url) {
  // Anything under /down/ simulates a provider that is out of quota.
  if (url.pathname.startsWith('/down/')) {
    json(res, 429, { error: { message: 'mock quota exhausted' } }, { 'Retry-After': '30' });
    return;
  }

  const { messages = [], model = 'mock' } = JSON.parse(raw || '{}');
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const last = messages.at(-1)?.content ?? '';
  const isReview = system.startsWith('You review');
  let content;

  if (isReview) {
    const draft = /<draft_answer>\n([\s\S]*)\n<\/draft_answer>/.exec(last)?.[1] ?? '';
    content = draft.startsWith(COMPLIMENT) ? draft.slice(COMPLIMENT.length) : 'OK';
  } else if (last.includes('errore429')) {
    json(res, 429, { error: { message: 'mock rate limit' } }, { 'Retry-After': '5' });
    return;
  } else {
    const turns = messages.filter((message) => message.role === 'user').length;
    content = `${last.includes('lusinga') ? COMPLIMENT : ''}[mock ${model}, domanda ${turns} della chat] Risposta a: ${last}`;
  }

  console.log(`${isReview ? 'review' : 'draft '} -> ${content}`);
  json(res, 200, { choices: [{ message: { role: 'assistant', content } }] });
}

/** A 384x384 PNG whose colours depend on the prompt: stands in for the image model. */
function fakeImage(prompt) {
  const size = 384;
  const hash = createHash('sha256').update(prompt).digest();
  const [r, g, b] = [hash[0], hash[1], hash[2]];
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      row[1 + x * 3] = Math.round(r * (1 - t) + 255 * t);
      row[2 + x * 3] = Math.round(g * (1 - t) + 255 * t * 0.6);
      row[3 + x * 3] = Math.round(b * (1 - t) + 255 * t * 0.9);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageCompletion(res, raw) {
  const prompt = JSON.parse(raw || '{}').contents?.[0]?.parts?.[0]?.text ?? '';
  console.log(`image -> ${prompt}`);
  // A prompt containing "BLOCKED" simulates the model's own safety filter: no picture comes back.
  const parts = prompt.includes('BLOCKED')
    ? [{ text: 'I cannot create this image.' }]
    : [{ text: 'Here it is.' }, { inlineData: { mimeType: 'image/png', data: fakeImage(prompt).toString('base64') } }];
  json(res, 200, { candidates: [{ content: { parts } }] });
}

function authorizePage(res, url) {
  const hidden = ['redirect_uri', 'state', 'client_id']
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(url.searchParams.get(name) ?? '')}">`)
    .join('');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Mock sign-in</title>
<h1>Mock Google sign-in</h1>
<form method="get" action="/oauth/continue">
  ${hidden}
  <p><label>Email <input name="email" type="email" value="test@example.com" required></label></p>
  <p><label>Name <input name="name" value="Test User" required></label></p>
  <button type="submit">Continue</button>
</form>`);
}

function authorizeContinue(res, url) {
  const redirect = new URL(url.searchParams.get('redirect_uri'));
  const code = base64Url({
    email: url.searchParams.get('email'),
    name: url.searchParams.get('name'),
    aud: url.searchParams.get('client_id'),
  });
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
  res.writeHead(302, { Location: redirect.toString() }).end();
}

function token(res, raw) {
  const { email, name, aud } = JSON.parse(Buffer.from(new URLSearchParams(raw).get('code') ?? '', 'base64url').toString());
  const claims = {
    iss: 'https://accounts.google.com',
    aud,
    sub: createHash('sha256').update(email).digest('hex').slice(0, 21),
    email,
    email_verified: true,
    name,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  console.log(`sign-in -> ${email}`);
  json(res, 200, { id_token: `${base64Url({ alg: 'none' })}.${base64Url(claims)}.` });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === 'POST' && url.pathname.endsWith(':generateContent')) return imageCompletion(res, await readBody(req));
    if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) return chatCompletion(res, await readBody(req), url);
    if (req.method === 'GET' && url.pathname === '/oauth/authorize') return authorizePage(res, url);
    if (req.method === 'GET' && url.pathname === '/oauth/continue') return authorizeContinue(res, url);
    if (req.method === 'POST' && url.pathname === '/oauth/token') return token(res, await readBody(req));
    res.writeHead(404).end();
  } catch (error) {
    console.error(error);
    res.writeHead(400).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Mock services listening on http://127.0.0.1:${PORT}`));

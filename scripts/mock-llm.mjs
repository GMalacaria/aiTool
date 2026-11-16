#!/usr/bin/env node
// Minimal OpenAI-compatible Chat Completions mock for local development
// without an API key. Set OPENAI_BASE_URL=http://127.0.0.1:8788/v1 in .dev.vars.
//
// - Draft calls echo the question. If the question contains "lusinga", the
//   draft starts with a compliment so the review pass has something to fix.
// - Review calls answer "OK", or strip the compliment from the draft.
// - A question containing "errore429" makes the mock answer HTTP 429.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8788);
const COMPLIMENT = 'Ottima domanda! ';

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const { messages = [] } = JSON.parse(raw || '{}');
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const last = messages.at(-1)?.content ?? '';
    let content;

    if (system.startsWith('You review')) {
      const draft = /<draft_answer>\n([\s\S]*)\n<\/draft_answer>/.exec(last)?.[1] ?? '';
      content = draft.startsWith(COMPLIMENT) ? draft.slice(COMPLIMENT.length) : 'OK';
    } else if (last.includes('errore429')) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
      res.end(JSON.stringify({ error: { message: 'mock rate limit' } }));
      return;
    } else {
      content = `${last.includes('lusinga') ? COMPLIMENT : ''}[mock] Risposta a: ${last}`;
    }

    console.log(`${system.startsWith('You review') ? 'review' : 'draft '} -> ${content}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Mock LLM listening on http://127.0.0.1:${PORT}/v1`));

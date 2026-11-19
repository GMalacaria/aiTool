# aiTool (Kern)

A free web app for asking questions to a generative AI that behaves like a tool, not a companion:

- answers the question and nothing more — no flattery, no small talk;
- does not try to keep the user in the chat;
- does not build an emotional bond (no persona, name or avatar);
- corrects wrong statements instead of agreeing;
- states uncertainty when there is any.

Success metric: **question solved, chat closed**.

## Status

Early stage — working MVP, used by one family (no plan to open it to the public for now). Deployed on Cloudflare Workers. Installable on phones as a PWA.

Access: Google sign-in; new accounts wait for an administrator's approval. Signed-out visitors see the chat, and trying to use it asks them to sign in.

## What it does

- **Answers** in Markdown: tables, lists, code blocks, and diagrams (flowcharts, timelines, mind maps…) drawn in the chat. Text meant to be used elsewhere (an email, a message) comes in a card with a copy button.
- **Fonti** (verified sources): a switch next to the request field. For factual questions the answer is searched on the web, every fact gets a numbered source with a link, and a second, independent model checks each fact against the page; `[?]` marks a fact no source confirms. Answers take about 10–20 seconds. Without the switch, a factual answer offers a "Verifica fonti" button.
- **Ragiona** (selector "Normale / Ragiona"): a more in-depth answer from a stronger model, with its own small daily allowance.
- **Microphone** (professional profile only): dictation of the request; the text appears while speaking, is never sent automatically, and the audio is not stored.
- **Attachments** ("+"): images and PDFs, prepared on the device (images downscaled, PDF text extracted, scanned pages turned into images). The PDF text and the images are kept with the chat so follow-up questions work; the original PDF file never is.
- **Documents** on explicit request only ("fammi un PDF…", "crea un file Excel…"): text, tables, charts, quizzes and diagrams, exported to PDF and Excel on the device.
- **Images** on explicit request only ("genera un'immagine di…") and edits of attached or generated images ("rendila in bianco e nero"), behind a content filter that fails closed.
- **Maps and videos** when asked to show something real ("mostrami la mappa di Roma"); photos of real products are never shown (copyright), a link to the official page is given instead. Explanations may include up to three freely licensed pictures from Wikimedia Commons, with author and licence.
- **User context**: a short list of facts the user chose to share (job, school, preferred format), visible and editable in Profilo, with history and a pause switch.
- ChatGPT-style sidebar with chat search, rename and delete; light/dark theme.

## Profiles

Set per person by an administrator.

- **Professional** (default): direct answers; all features, including dictation.
- **Student**: a tutor. It explains the method, gives the next step and checks the student's attempts, but never hands over the solution of homework, exercises, tests, translations or essays (documents become study guides). Plain factual questions are still answered directly. No dictation.

## Daily limits

Each person has daily limits, editable by administrators and shown under the request field and in Profilo:

| Limit | Default |
|---|---|
| Messages | 15 |
| "Ragiona" answers | 3 |
| Images | 3 |
| Paid tokens | 100,000 |

- Past the token budget the user is in **free mode** until midnight (Italian time): answers come from free models (Groq, Gemini) and are labelled; "Ragiona", attachments and "Fonti" are off. When the free models are exhausted too, the app says to come back tomorrow.
- A chat holds at most 30 requests; the last five are counted down.
- Web search for "Fonti" has an app-wide daily cap, paid by the owner and not counted against the user.

## How it stays a tool

- Every answer goes through a second "anti-sycophancy" review call that removes flattery and agreement with mistakes.
- No personality, human name, avatar or voice replies; no "is typing…".
- No memory across chats (only the user context above).
- A fixed note after every 10th question reminds that this is a tool, not a person.
- Sensitive topics (mental health, self-harm, violence) get a fixed answer pointing to real services, never stored.
- Asked "cosa sei?" or "cosa sai fare?", Kern describes its principles, features, profiles and limits briefly and without self-praise.
- No advertising, no data selling.

## Data

- Conversations are stored per account (Cloudflare D1, EU) and can be deleted: one chat, all chats, or the whole account. Images are stored in R2 (EU) and deleted with their chat.
- Usage is logged per request (tokens, images, estimated cost, providers), never the message content.
- Models: OpenAI for answers, Google Nano Banana for images, Gemini for source checks, free Groq/Gemini models as fallback. Free models never receive attachments or the user context.

## Development

Requires Node.js 22 or later.

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in, or enable the local mocks
npm run db:migrate               # create/update the local D1 database
npm run mock                     # only when using the local mocks
npm run dev
```

The emails listed in `ADMIN_EMAILS` are approved automatically and can approve other users from the "Utenti" view.

- `src/` — React frontend (Vite).
- `worker/` — Cloudflare Worker (Hono), API under `/api/*`.
- `shared/` — code used by both (document format and validation).
- `migrations/` — D1 schema.
- `npm test` runs the unit tests; `npm run build` typechecks and builds.
- `npm run mock` starts local stand-ins for the model and for Google sign-in, for working without real credentials (see `.dev.vars.example`).
- `npm run deploy` deploys to Cloudflare.

## Contributing

The repository is public for transparency, but external contributions are not accepted for now.

Workflow:

- `main` is protected; changes land only through pull requests from development branches (`feat/…`, `fix/…`, `chore/…`, `docs/…`), merged and deployed by the owner.
- Everything in the repository is written in English. User-facing UI copy is Italian.

## License

No license is granted. All rights reserved.

The source code is publicly visible for transparency only: you may read it, but you may not copy, modify, redistribute or use it without the author's written permission.

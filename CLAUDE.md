# CLAUDE.md — ConoscenzIA (code name: aiTool)

## Repository rules

- **Everything in the repository is in English**: code, identifiers, comments, commit messages, branch names, PR titles/descriptions, documentation. The only exception is user-facing UI copy, which is Italian.
- **`main` is protected**: never commit or push to it directly. All changes land through a pull request from a development branch.
- Branch names: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- For now only the repository owner creates branches and commits. External contributions are not accepted yet.
- Never commit secrets (API keys, `.env` files).

## Name

- **Visible name** (UI, icon, PWA title): **ConoscenzIA**.
- **Code name** (repository, packages, variables, identifiers): **aiTool**.
- ConoscenzIA is for family and Italian use; an international launch would need a distinctive name that is pronounceable in several languages, to be checked (domain and UIBM/EUIPO trademark) before launch. "Utilis" was discarded: already used in software.

## Project goal

A free web app where anyone (adults, fragile people, in the future possibly minors) can ask questions to a generative AI that:

- **gives the requested information and nothing more**, with no flattery, compliments or "nice words";
- **does not try to retain the user** in the chat: no questions to prolong the conversation, no invitations to come back;
- **does not create an emotional bond**: no personality, human name or avatar; it presents itself as a tool;
- **points out errors and inaccuracies** in the user's statements instead of agreeing;
- states uncertainty when there is any.

Success metric: **question solved and chat closed**, not time spent or number of messages.

Similar existing reference: Noema (pilot project that observes conversations and corrects the chatbot when it detects dependency or sycophancy).

## Decisions taken

- **Free for the user** through the free tiers of LLM APIs, with a **daily message limit per user**.
- **Family use: budget of €10–15/month** to get better results than the free tiers (see "Models").
- Free-tier quotas apply **per developer account (the whole app)**, not per end user: the per-user limit is computed by dividing the total quota.
- **Multiple providers with automatic fallback**: a single OpenAI Chat Completions–compatible client that moves to the next provider on 429 / quota exhausted.
- **Future "bring your own key" (BYOK) option** for technical users, next to the shared quota. The user's key stays on their device and is never stored on the server.
- No unofficial routes (e.g. reusing the user's ChatGPT login): they violate terms of use.
- No advertising and no data selling: they would create the incentive to retain the user.

## Features

- **First use: family and close colleagues.** Each person signs in with Google and has a daily limit; API keys belong to the developer only and live in the backend.
- **Mobile app as a PWA** (installable from the browser); possibly a native app with Capacitor.
- **Answer format** (changed 2026-11-17): text answers use **Markdown**, rendered by `src/Markdown.tsx` (react-markdown + remark-gfm: tables, lists, code blocks, bold; raw HTML ignored, images never loaded, links open in a new tab with safe protocols only). Tables, comparisons, schemes and quizzes are shown in the chat as Markdown; text diagrams go in code blocks. User messages stay plain text. Mermaid-style graphical diagrams are not supported.
- **Document creation** (added 2026-11-16, narrowed 2026-11-17): a downloadable file is produced **only when the user explicitly asks for one** ("crea un documento…", "fammi un PDF…", "prepara un file Excel…", or asks to change the document just created); never by inference (product decision). There is no button. A first, tiny call on the standard model classifies the message as `text` or `document` (`INTENT_SYSTEM_PROMPT`, reasoning switched off through the provider's `fastParams`); a table or a quiz without mention of a file is `text`; anything unclear, or a failed call, means text. For a document the model returns a JSON description (`shared/document.ts`: headings, paragraphs, lists, tables, bar/line/pie charts, quizzes) in JSON mode. The Worker validates it against size limits; the frontend renders the preview and builds the PDF (pdfmake) and Excel (write-excel-file) files on the device, loading those libraries on demand. The model never produces files or code. No review pass for documents. When numbers were not supplied by the user, the document carries a fixed disclaimer. To keep text answers fast, the text draft starts while the intent is detected and is dropped in the document case (not with the in-depth model, which is too expensive to run speculatively). Function calling was tried and rejected: OpenAI does not allow function tools together with reasoning for `gpt-6-luna` on Chat Completions. Future generated-content types (e.g. images) follow the same rule: explicit request only, no new button. TODO: diagrams (flowcharts, maps) inside documents.
- **Attachments** (added 2026-11-16): the "Allega" button adds images and PDFs to a question (`shared/attachments.ts`, `src/attachments/`). Everything is prepared on the device: images are downscaled to 1568 px and re-encoded as JPEG (which also drops EXIF data); PDF text is extracted with pdf.js (first 30 pages, 60,000 characters); a scanned PDF has its first 5 pages rendered as images. Limits per message: 3 documents, 5 images. The Worker validates the payload and rejects the whole request if anything is malformed. Document text goes to the model inside `<attached_document>` blocks and is stored with the message, so follow-up questions work; images are sent as `image_url` parts and never stored (only their names). The client never receives stored document text back. Requires a vision-capable model: keep that in mind when adding fallback providers.
- **Image generation** (implemented 2026-11-17, not yet deployed): only on an **explicit request** ("genera un'immagine di…", "disegnami…", or a change to the image just created), like documents: no button; the intent classifier has a third value, `image`. Model: Nano Banana 2 Lite, `gemini-3.1-flash-lite-image` through `generateContent` (default id, overridable with `GEMINI_IMAGE_MODEL`; checked against the real API on 2026-11-17: the key authenticates and the model id and request shape are accepted, but the answer was 429 "free tier, limit 0" because billing was not enabled on the key's Google project, then billing was enabled and a real generation worked the same day: the response parts hold an `inlineData` JPEG of about 850 KB (1408×768) taking about 8 s through the app, and a follow-up change ("rendila più scura") builds on the earlier description. Not yet checked in production with a real session: a Worker on the free plan has a 10 ms CPU limit and the picture is decoded in the Worker (the native base64 decoder is used when the runtime has it); if image requests fail in production with a CPU error, that is the first suspect). Needs a **paid** Google AI key in `GEMINI_IMAGE_API_KEY`, kept apart from `GEMINI_API_KEY` (the free-tier text fallback); without it the feature is off and the app says so.
  - **Content filter** (worker/chat.ts `planImage`, `worker/images.ts`): (1) OpenAI moderation on the user's message; (2) a planner call (standard model, JSON) that refuses real identifiable people, sexual content, minors in any intimate or harmful situation, graphic violence, self-harm, hate content, weapons/drug instructions, trademarked characters and deceptive fake documents, and otherwise writes the English prompt; (3) moderation again on that prompt; (4) the image model's own safety filters (no picture returned = polite refusal, allowance refunded). Everything **fails closed**: if moderation or the planner is unavailable, no image is produced.
  - **Limits**: separate daily allowance per user (`users.daily_image_limit`, default 3, editable by administrators), on top of the general message limit; ≈ $0.034 per image, so at most ≈ $0.10 per person per day.
  - **Storage** (owner's choice, 2026-11-17): the files are kept in **R2** (bucket `aitool-images`, EU jurisdiction, binding `IMAGES`, key = image id) so they reopen from the history. Only their owner can read them (`GET /api/images/:id`, private cache, `nosniff`, sandbox CSP). Deleting a chat, all chats or the account deletes the files first. The model remembers an image only through the English description stored as the assistant message ("Image generated from this description: …"), which is what lets it build on it for "rendilo più scuro".
  - Every image is labelled "generata dall'intelligenza artificiale" in the UI, with a download link.
  - **Before deploying**: enable R2 in the Cloudflare dashboard, create the bucket (`npx wrangler r2 bucket create aitool-images --jurisdiction eu`), add the secret (`npx wrangler secret put GEMINI_IMAGE_API_KEY`), apply migration 0006, then deploy.
- **No voice output (text-to-speech): it creates a relationship.** Product decision.

## Models (family use, November 2026 prices — verify)

| Role | Model | Price | Estimated cost/month |
|---|---|---|---|
| Default chat | **GPT-6 Luna** (`gpt-6-luna`) | $0.10 input / $0.50 output per million tokens | ~$2 |
| "More in-depth answer" chat | **GPT-6 Sol** (`gpt-6-sol`), on user request | $2 / $10 per million tokens | ~$4–5 (if ~20% of messages) |
| Anti-sycophancy check | Always **GPT-6 Luna**, even when the answer comes from Sol | same as Luna | included above |
| Image reading | GPT-6 Luna / Sol (accept text and images) | as above | included |
| Image generation | **Nano Banana 2 Lite** (Gemini 3.1 Flash Lite Image) | ~$0.034 per image | ~$3–5 (100–150 images) |
| Fallback | Free tiers (Groq, Gemini Flash-Lite, OpenRouter) | 0 | 0 |

Model choice in the UI:
- Luna is the default; Sol is enabled by a "More in-depth answer" button, **without showing model names**.
- **Daily per-user limit on Sol answers** (e.g. 3–5), on top of the general message limit.
- Implemented 2026-11-16: a per-message "Risposta più approfondita" checkbox; default allowance 3 per day (`users.daily_deep_limit`, editable by administrators). An in-depth answer also counts as one normal message. It uses `gpt-6-sol` with a longer output cap (1,800 tokens) and an extra system-prompt instruction; the review pass stays on Luna. If the allowance is used up, or Sol fails, the answer falls back to the standard model and the allowance is not consumed.
- Everything on Sol would cost ~$35–40/month: out of budget, to be avoided.

Estimate assumptions: ~6 users, ~15 messages/day each, ~2,000 tokens per call, anti-sycophancy check enabled (2 calls/message).

Rules:
- Set a **spending cap** in each provider's console (OpenAI and Google). Expected total ~€10/month.
- Prefer paid plans that do not use data for training; verify the terms.
- Avoid providers with data outside the EU without guarantees (e.g. DeepSeek), since users are family members, including teenagers.
- The multi-provider router also protects against price changes.
- **Fallbacks implemented 2026-11-17** (`worker/llm/providers.ts`): Groq (`llama-3.3-70b-versatile`) and Gemini (`gemini-flash-lite-latest`) through their OpenAI-compatible endpoints, each enabled only if its secret (`GROQ_API_KEY`, `GEMINI_API_KEY`) is set; models and endpoints can be overridden (`*_MODEL`, `*_BASE_URL`). Order: OpenAI, Groq, Gemini. They serve only the standard tier (never the in-depth answers), and **never receive attached files** (images, extracted document text, also from earlier messages), because free tiers may train on the data and colleagues' conversations can hold private documents; such requests fail with a clear message while OpenAI is unavailable. Model ids are defaults to verify against the provider consoles. Not yet tried against the real providers.

## Interface (2026-11-17)

- ChatGPT-style sidebar (`src/ui/Sidebar.tsx`): tool name with a search icon (also Ctrl/Cmd+K) and a collapse icon (collapsed state remembered per device; on phones the sidebar is an overlay); "Nuova chat"; scrollable list of chats with fixed width, one line, fading end; rename and delete appear on hover or focus (always on touch screens) and open native modal dialogs (`src/ui/Modal.tsx`, `<dialog>` with `showModal()` and `closedby="any"` plus a light-dismiss fallback). The footer shows the user's name and profile and opens a popover menu (Popover API, anchored with `position-area`, fixed fallback): Profilo, Impostazioni, Utenti (admins only), Esci.
- New conversations get a 2–4 word title from the standard model, generated from the question in parallel with the answer (metered, purpose `title`); the start of the question is the fallback.
- Search (`GET /api/conversations/search?q=`) matches titles and message text (case-insensitive `LIKE`, wildcards escaped), returns an excerpt around the match.
- Pages: Impostazioni (delete history, delete account), Utenti (admin).

## Usage, budgets and profiles (added 2026-11-17)

- **Why**: the monthly budget only holds if every person has a daily ceiling on tokens, not only on messages.
- **Usage log** (`usage_events`, `worker/meter.ts`): one row per chat request with paid and free input/output tokens, images, estimated cost in micro-USD and the providers used. No message content. Every model call goes through the meter (intent, draft, review, document, image planning), including a speculative draft that is later discarded and requests that fail. Prices are in `worker/llm/providers.ts` (`OPENAI_PRICES`) and `IMAGE_PRICE_USD`; they are estimates to keep up to date.
- **Daily paid-token budget** per user (`users.daily_token_limit`, default 100,000, counted in `daily_usage.paid_tokens`). Past it the user is in **free mode** until midnight (Italian time): only free-tier models answer (Groq, Gemini); in-depth answers and attachments are not available (free tiers never receive attachments); images still follow their own allowance. The UI says so with a banner, labels each answer written by a free model, and shows the share of tokens used. When the free tiers are out of quota too, the user gets "token giornalieri e modelli gratuiti esauriti, torna domani" (`free_quota_exhausted`); with no free provider configured, `tokens_exhausted`. A request can overshoot the budget once, because tokens are counted after it.
- **Profiles** (`users.profile`): `professional` (default, the normal behaviour) and `student`: a tutor that never hands over the solution of homework, exercises, tests, translations or essays, explains the method, gives the next step and checks the student's attempts; plain factual questions are still answered directly. Applied to the answer prompt, the review prompt (which also removes full solutions) and the document prompt (homework becomes a study guide).
- **Administration** ("Utenti"): per user profile, daily limits (messages, in-depth answers, images, paid tokens), today's and this month's usage, a day-by-day table for the last 30 days, and the estimated monthly cost of everybody.

## MVP decisions (confirmed 2026-11-16)

- **Backend stack**: Cloudflare Workers (free tier), TypeScript, Hono. The React frontend is served by the same Worker as static assets.
- **Login** (changed 2026-11-16, replaces personal access codes): Google sign-in only. Anyone can sign in, but a new account stays **pending until an administrator approves it**. Administrators are the emails in `ADMIN_EMAILS`; they manage users from the "Utenti" view. The daily limit is per person.
- **Audience** (changed 2026-11-17): **family use only**; there is no expansion plan for now. The tool must be safe, not limited. (On 2026-11-16 it was "family plus adults the family works with".)
- **Message history** (changed 2026-11-16): conversations are stored on the server (D1, EU jurisdiction), tied to the account. The user can reopen them, delete one, delete all, or delete the whole account. The model never sees other conversations: no memory across chats. Fixed answers on sensitive topics are never stored.
- **First provider**: OpenAI GPT-6 Luna from the start; free tiers are added later as fallback through the router.
- **Anti-sycophancy check**: on every answer (second call that verifies and, if needed, rewrites).

## To be confirmed

- MVP for adults only (minors bring much heavier legal and safety obligations).

## Open product questions (recorded 2026-11-17, not decided)

The owner first needs to understand **how to turn this into a product**. Nothing below is decided; do not build for any of it until the owner chooses. Today the app is a private family tool.

1. **Subscription or not?**
   - No subscription: free for everyone, paid by the owner (today ≈ €10–15/month for ~6 people, i.e. roughly €2 per person; images and in-depth answers push it up). Does not scale: cost grows with every user, so it only works for a closed group or with hard per-user limits.
   - Subscription: users pay a monthly fee that must cover the usage of a typical user plus payment fees and VAT. Needs: payment provider, accounts and plans, invoicing and tax, cancellation and refunds, support. The existing per-user daily limits (messages, in-depth answers, images) are the natural basis for plan tiers.
   - Bring your own key (BYOK, already on the roadmap): the user pays the provider directly with their own key; the owner pays nothing per use. Good for technical users, not for the general public.
2. **Offer an API?** Expose the tool to other developers or apps with API keys, per-key rate limits and billing, instead of (or besides) the web app. Questions: who would call it and why; the behaviour that makes the product different (no flattery, no retention, error correction) lives in the system prompt and the review pass, so an API would sell that layer on top of the models; metering, abuse protection and key management would be new work; an API makes the owner responsible for what third parties send.
3. **Free version using only free models?** Possible in principle (Groq, Gemini and OpenRouter free tiers; the multi-provider router and the fallbacks already exist) but: the quotas belong to the owner's developer account, **not to each user**, so they are shared by everybody (the estimate in this file is ≈ 53 users/day); free tiers change or shrink without notice (e.g. Gemini cut by 50–80% in 2026) and are meant for prototypes; the free models are weaker; no images, no in-depth answers, and the free tiers may train on the data. A realistic shape could be: free = free models with low limits; paid = OpenAI models, images and in-depth answers.
4. **Facts to collect before deciding**: real monthly cost per user from the app's own usage (not yet measured); who the target users would be; whether the owner wants this to be income, a service to others, or only to learn; how much time the owner can spend on support and billing.

Things the owner explicitly parked: privacy notice and data retention (**dropped on 2026-11-17: family use only, no expansion plan**). They become relevant again only if the audience grows beyond the family; see the next section.

## Development

- `npm run dev` — Vite dev server with the Worker running locally (frontend + `/api/*`).
- `npm test` / `npm run build` (includes typecheck) — must pass before opening a PR.
- `npm run db:migrate` — apply D1 migrations locally (`db:migrate:remote` for production).
- `npm run mock` — local stand-ins for the model and for Google sign-in; enable them in `.dev.vars` (see `.dev.vars.example`).
- Secrets (in `.dev.vars` locally, `wrangler secret put` in production): `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`; optional: `GROQ_API_KEY`, `GEMINI_API_KEY` (free-tier text fallbacks), `GEMINI_IMAGE_API_KEY` (paid, image generation).
- Google OAuth redirect URI: `<origin>/api/auth/google/callback`.
- Auth: server-side OAuth code flow, then an HttpOnly `session` cookie (30 days; only the token hash is stored). State-changing requests must carry a same-origin `Origin` header.
- API: `/api/images/:id` (GET, owner only), `/api/auth/google/start|callback`, `/api/auth/logout`, `/api/me` (GET, DELETE), `/api/conversations` (GET, DELETE), `/api/conversations/:id` (GET, DELETE), `/api/chat` (POST `{conversationId, message, attachments, deep}`; the reply carries `document` when the answer is a document), `/api/admin/users` (GET), `/api/admin/users/:id` (PATCH).
- Unverified assumption: the OpenAI request omits `temperature` (set per provider in `worker/llm/providers.ts`).
- `npm run deploy` — build and deploy to Cloudflare (needs `wrangler login`).
- Layout: `src/` React frontend, `worker/` Cloudflare Worker (API under `/api/*`), `shared/` code used by both.
- Local secrets go in `.dev.vars` (git-ignored); production secrets via `wrangler secret put`.
- The project `.npmrc` pins the public npm registry: never let the lockfile reference another registry.

## Architecture

```
[React frontend]  →  [Lightweight backend]  →  [Provider router]  →  Groq / Gemini / OpenRouter / Mistral …
                         │
                         ├─ hides API keys (never call LLMs from the client with the shared key)
                         ├─ enforces the daily per-user limit
                         ├─ injects the anti-sycophancy system prompt
                         ├─ truncates history (tokens per day are the bottleneck)
                         ├─ detects sensitive topics → fixed answer pointing to real services
                         └─ (optional) second pass: verify/rewrite the answer
```

### Provider router

- All providers expose OpenAI-compatible endpoints: a single client, ordered list of `{provider, baseURL, model, apiKey}`.
- On 429 or quota error: move to the next one; keep the "exhausted until reset" state in memory.
- Read the rate-limit headers (e.g. `x-ratelimit-remaining-*` on Groq) instead of guessing.
- Daily resets are not aligned (e.g. Gemini at midnight Pacific time).

### Token containment

With free tiers the blocking limit is almost always **tokens per day**, not requests per day. Therefore:

- short system prompt;
- history limited to the last N turns (or a summary);
- small output `max_tokens`;
- low temperature.

## Model behaviour (guidelines for the system prompt)

- Mathematics is written in plain text with Unicode symbols, never LaTeX (the chat does not render LaTeX).

- Direct answer to the question, no preamble.
- No compliments ("great question" etc.), no expression of its own emotions.
- No closing question to continue the conversation, except for indispensable clarifications.
- If the user states something wrong, correct it explicitly.
- State uncertainty; do not make things up.
- Impersonal, tool-like tone ("this tool has no personal opinions…").
- Do not go along with requests for a relationship/friendship: remind that it is a tool and, if needed, point to real people or services.
- "Neutral" does not mean "cold": with users in difficulty stay polite and brief, and point to human help.

## Product design against bonding

- The model has no memory across conversations. The stored history is explicit and user-controllable (reopen, delete).
- No avatar, human name, or "is typing…" indicator.
- Periodic reminder "this is a tool, not a person" — implemented 2026-11-17 (`src/reminder.ts`): a fixed Italian note shown after the answer to every 10th question of a conversation, also when an old one is reopened. It is computed in the browser from the messages, never produced by the model and never stored. A conversation-length limit is not implemented.
- Honest message when the quota is used up: "Daily limit reached, come back tomorrow."
- Sensitive-topic detection (mental health, self-harm, violence) with a fixed answer and real numbers/services.

## Free providers (data collected in November 2026 — verify in the consoles)

| Provider | Model | Req/day | Tokens/day | Notes |
|---|---|---|---|---|
| Groq | llama-3.1-8b-instant | 14,400 | 500,000 | Per-organization limits; does not train on data |
| Groq | llama-3.3-70b-versatile | 1,000 | 100,000 | |
| Groq | openai/gpt-oss-120b | 1,000 | 200,000 | |
| Groq | openai/gpt-oss-20b | 1,000 | 200,000 | Some sources: 14,400 / 500,000 |
| Google Gemini | Flash-Lite | ~500 | — | Per-project limits, AI Studio only; in the EU paid-service terms apply (no training) |
| Google Gemini | Flash | ~20 | — | Negligible quota |
| OpenRouter | `:free` models | 50 (1,000 after a one-off $10 credit purchase) | — | Training depends on the downstream provider |
| Mistral | Free mode | from console | from console | Training on by default, opt-out in the Admin panel; EU company |
| Cloudflare Workers AI | various | 10,000 neurons/day | — | Conversion to requests to be measured |
| Cerebras | — | — | — | Free tier closed in July 2026: excluded |

Estimate with 2,000 tokens/call, 2 calls/message, 10 messages/user: **~53 users/day**, peak ~26 messages/minute.
Spreadsheet with editable parameters: https://claude.ai/artifact/1mj4nYV9vSnjFzmAX4hiRx

Free tiers change without notice (e.g. Gemini cut by 50–80% in 2026) and are often meant for prototypes: plan for graceful degradation.

## Privacy and obligations (parked 2026-11-17: family use only; revisit if the audience grows)

- **GDPR**: data minimization; in Italy parental consent under 14; care with sensitive data.
- **EU AI Act**: transparency obligation (the user must know they are talking to an AI); care with systems aimed at vulnerable people.
- **Provider terms of use**: many restrict use by minors; also check whether the free tier uses data for training.
- Conversations are stored on the server since 2026-11-16 (product decision). Parked by the owner (family use only): privacy notice and retention period. Self-service deletion of chats and of the account already exists. They must be done before opening the app to anyone outside the family.

## Working conventions

- Developer: experienced frontend (Angular, now React).
- UI language: Italian. Repository language: English.
- Direct, concise answers and explanations; flag any inaccuracies in the assumptions.

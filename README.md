# aiTool (ConoscenzIA)

A free web app for asking questions to a generative AI that behaves like a tool, not a companion:

- answers the question and nothing more — no flattery, no small talk;
- does not try to keep the user in the chat;
- does not build an emotional bond (no persona, name or avatar);
- corrects wrong statements instead of agreeing;
- states uncertainty when there is any.

Success metric: **question solved, chat closed**.

## Status

Early stage — working MVP slice, local only (not deployed):

- sign-in with a personal access code, daily message limit per person;
- chat through an OpenAI-compatible provider router;
- every answer goes through a second "anti-sycophancy" review call;
- fixed answers pointing to real services for sensitive topics.

## Development

Requires Node.js 22 or later.

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your OpenAI key in it
npm run db:migrate               # create the local D1 database
npm run user:add -- "Name"       # prints the access code once
npm run dev
```

- `src/` — React frontend (Vite).
- `worker/` — Cloudflare Worker (Hono), API under `/api/*`.
- `migrations/` — D1 schema.
- `npm test` runs the unit tests; `npm run build` typechecks and builds.
- `npm run mock:llm` starts a local fake model for working without an API key (see `.dev.vars.example`).
- `npm run deploy` deploys to Cloudflare.

## Contributing

The repository is public for transparency, but external contributions are not accepted for now.

Workflow:

- `main` is protected; changes land only through pull requests from development branches (`feat/…`, `fix/…`, `chore/…`, `docs/…`).
- Everything in the repository is written in English. User-facing UI copy is Italian.

## License

No license is granted. All rights reserved.

The source code is publicly visible for transparency only: you may read it, but you may not copy, modify, redistribute or use it without the author's written permission.

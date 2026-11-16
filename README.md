# aiTool (ConoscenzIA)

A free web app for asking questions to a generative AI that behaves like a tool, not a companion:

- answers the question and nothing more — no flattery, no small talk;
- does not try to keep the user in the chat;
- does not build an emotional bond (no persona, name or avatar);
- corrects wrong statements instead of agreeing;
- states uncertainty when there is any.

Success metric: **question solved, chat closed**.

## Status

Early stage — working MVP:

- Google sign-in; new accounts wait for an administrator's approval;
- daily message limit per person;
- chat through an OpenAI-compatible provider router;
- every answer goes through a second "anti-sycophancy" review call;
- conversation history stored per account, deletable by the user (single chat, all chats, whole account); the model has no memory across conversations;
- fixed answers pointing to real services for sensitive topics (never stored);
- installable as a PWA.

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
- `migrations/` — D1 schema.
- `npm test` runs the unit tests; `npm run build` typechecks and builds.
- `npm run mock` starts local stand-ins for the model and for Google sign-in, for working without real credentials (see `.dev.vars.example`).
- `npm run deploy` deploys to Cloudflare.

## Contributing

The repository is public for transparency, but external contributions are not accepted for now.

Workflow:

- `main` is protected; changes land only through pull requests from development branches (`feat/…`, `fix/…`, `chore/…`, `docs/…`).
- Everything in the repository is written in English. User-facing UI copy is Italian.

## License

No license is granted. All rights reserved.

The source code is publicly visible for transparency only: you may read it, but you may not copy, modify, redistribute or use it without the author's written permission.

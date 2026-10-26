# Expense Ledger

A personal expense dashboard for recording, filtering, and analyzing spending, with optional local Ollama/Gemma categorization and insights.

## Run & Operate

- The managed `artifacts/expense-ledger: web` and `artifacts/expense-ledger: Flask API` workflows run the dashboard and Python API.
- `pnpm --filter @workspace/expense-ledger run typecheck` — check the dashboard types
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and schemas
- Set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and optionally `DB_PORT` to use MySQL; initialize it with `artifacts/expense-ledger/server/database.sql`.
- Without MySQL settings, the API creates a local SQLite database automatically.
- Set `OLLAMA_URL` and `OLLAMA_MODEL` to connect local Ollama/Gemma; rule-based categorization and summaries work without it.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/expense-ledger/src/` — React dashboard, interactions, and theme
- `artifacts/expense-ledger/server/` — Flask API, Pandas/NumPy analytics, Matplotlib charts, and local Ollama adapter
- `artifacts/expense-ledger/server/database.sql` — MySQL schema and default categories
- `lib/api-spec/openapi.yaml` — generated client contract for the Flask API

## Architecture decisions

- Flask serves the expense API under `/ledger-api`; the React app uses the generated OpenAPI client.
- SQLite is the no-configuration local default; set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and optional `DB_PORT` for MySQL.
- Ollama runs locally and is optional; deterministic rules and statistical insights remain available when it is offline.
- Expense amounts are displayed in INR.

## Product

Users can add, edit, delete, filter, and recategorize expenses; rearrange dashboard widgets; inspect spend trends and statistics; and generate local AI suggestions.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- This is currently a single-user app without sign-in or per-user data isolation. Add authentication before publishing or sharing it with other people.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

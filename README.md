# ProStream Player Import

Admin-only Next.js application for scraping player data from CricHeroes and STUMPS and publishing it into ProStream Scoreboard player profiles.

## What it does

- Searches and previews CricHeroes and STUMPS players.
- Normalizes identity, role, batting, bowling, jersey, city, team, and career-stat data.
- Suggests matching profiles already in ProStream before publishing.
- Creates or enriches profiles using the unique `(source, external_id)` identity, so repeat imports are idempotent.
- Imports a CricHeroes team roster with visible per-player progress.
- Imports a scorer's **scoring record** from STUMPS (Scoring record tab): every completed match they scored, grouped by tournament, written to `scored_match_imports` and shown on the Scoreboard at `/scorers/<publicCode>`. Never counted in player stats. Re-importing refreshes the same rows.
- Authenticates against the existing Scoreboard `users` table and permits Admin accounts by default.

## Data-only guarantee

This application does **not** download, upload, replace, or clear player photos or team logos. Its database schema deliberately omits the Scoreboard image columns. Existing images remain untouched.

## Local development

Requirements: Node.js 20+ and access to the ProStream PostgreSQL database.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3100` and sign in with an allowed Scoreboard account.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The normalizer tests use captured source fixtures and do not call live services.

## Database dependency

The Scoreboard database must include migration:

```text
ProStream-Scoreboard/drizzle/migrations/0072_directory_source_stumps.sql
```

It adds the `stumps` label to the existing `directory_source` PostgreSQL enum. The migration is additive and idempotent.

The Scoring record tab also needs `0088_scored_match_imports.sql` (applied in production on 2026-11-06). Without it the tab explains the missing migration instead of failing.

## Dokploy

The included multi-stage `Dockerfile` builds the Next.js standalone server and listens on port `3000`. Configure Dokploy with:

- Dockerfile build
- Container port `3000`
- Health check path `/api/health`
- Environment variables from `.env.example`

Use the same private `DATABASE_URL` as Scoreboard and generate a distinct random `SESSION_SECRET` with at least 32 characters.

## Source behavior

Source requests are authenticated, rate-limited per process, and throttled by configurable minimum intervals. Publishing always re-fetches the source profile on the server, so clients cannot inject arbitrary player data. Only use the importer for data you are authorized to process and in accordance with the source service terms.

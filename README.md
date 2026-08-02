# Sagar Thapa — System Under Test

Production-oriented personal QA portfolio foundation. This is the new `sagar-portfolio-v2` repository and does not reuse the old portfolio.

## Prerequisites

- Node.js 24 or newer
- pnpm 11.18.0 through Corepack
- Docker Compose for local PostgreSQL

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
pnpm exec prisma generate
pnpm exec prisma validate
pnpm exec prisma migrate deploy
pnpm dev
```

Web: `http://localhost:3000`  
API: `http://localhost:4000/api/v1`  
Swagger: `http://localhost:4000/docs`

Replace every `.env` placeholder locally. Never commit the file or use the Docker development password outside local development. Generate an Argon2id admin hash outside source control.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm verify` runs the non-browser release gate. Playwright browser binaries must be installed separately with `pnpm exec playwright install chromium`. API integration tests use `DATABASE_URL`; the local Compose database is appropriate only for development and tests.

## Architecture

The monorepo uses Next.js, NestJS, Prisma/PostgreSQL, React Three Fiber, and pure TypeScript packages for shared contracts, media validation, adaptive 3D quality, and QA Rift scoring. Read [architecture](docs/architecture.md), [Sprint 1](docs/sprint-1.md), and the [content evidence register](docs/content-evidence.md).

## Missing assets

The final System Under Test GLB, project evidence, CV, and approved portrait are not committed. Sprint 1 uses a replaceable procedural scene, static HTML alternative, and clearly labelled placeholders. The expected portrait path exists as a tiny color placeholder at `apps/web/public/assets/images/portrait/sagar-portrait.png`; replace it only with the approved portrait.

## Branch policy

Work is developed on `build/sprint-1-foundation`. Do not commit directly to `main`; changes enter through a reviewed pull request.

# Architecture

## Decision summary

The portfolio is a progressively enhanced monorepo. Next.js owns semantic public and admin surfaces; NestJS owns the versioned REST contract; PostgreSQL/Prisma owns durable content; shared packages own contracts, validation, scene state, UI, and QA Rift rules.

The central visual metaphor is one replaceable **System Under Test** scene. HTML remains authoritative. WebGL is optional enhancement and cannot block navigation, content, forms, or case-study diagrams.

## Boundaries

- `apps/web`: App Router, server components by default, metadata, public routes, admin shell.
- `apps/api`: `/api/v1`, validation pipes, error envelope, Swagger, JWT guard, Prisma and projects modules.
- `packages/types`: transport-independent content and scene contracts.
- `packages/validation`: shared Zod validation and media safety policy.
- `packages/three`: quality degradation and scene-state contracts.
- `packages/game-engine`: pure deterministic game transitions and scoring; Phaser adapter comes later.
- `prisma`: database schema; no credentials or live data.

## Security decisions

Authentication is single-admin with no registration. Password verification uses Argon2id. The API mutation boundary uses a real JWT verifier and rejects requests when a secret is absent or still a placeholder. No bypass token exists in production code. The Next.js proxy and authenticated CMS layout reject missing server-side session cookies; `/admin/login` is outside that layout. Access tokens are short-lived; refresh sessions rotate and store only hashes. Refresh cookies are `HttpOnly`, `Secure` in production, `SameSite=Strict`, and scoped to auth routes. Production credential provisioning and the login/session issuance vertical are deliberately external, so login remains unavailable rather than insecure.

Projects use Prisma/PostgreSQL with validated create/update DTOs, stable pagination, filtering and sorting, conflict responses for duplicate slugs, transactional audit events, and an initial migration. Unit tests isolate Prisma behind mocks; the integration suite executes the same service against PostgreSQL when `DATABASE_URL` is present.

Media is denied by default. Filename, extension, detected MIME, size, traversal, double extensions, SVG sanitization, and upload storage isolation are enforced before publication.

## Performance and accessibility

The experience preference provider persists sound, motion, and quality in local storage and detects `prefers-reduced-motion`. The quality ladder degrades DPR, particles, post-processing, shadows, transparency, model variant, animation, then WebGL/poster fallback. Reduced motion prevents R3F idle/Float animation. WebGL failure and context loss expose a static diagnostic diagram. The canvas is decorative to assistive technology; equivalent meaning remains in HTML.

## ADRs

1. Use a procedural R3F greybox behind a stable `SystemSceneState` API; replace with GLB without page rewrites.
2. Keep Phaser out of homepage bundles; `game-engine` is pure TypeScript.
3. Store factual metrics as records with verification state, never decorative constants.
4. Keep placeholder media labelled and never present it as evidence.
5. Use Docker Compose PostgreSQL locally; staging/production databases are external and credential-driven.

# Architecture

## Decision summary

The portfolio is a progressively enhanced monorepo. Next.js owns semantic public and admin surfaces; NestJS owns the versioned REST contract; PostgreSQL/Prisma owns durable content; shared packages own contracts, validation, scene state, UI, and QA Rift rules.

The central visual metaphor is one replaceable **System Under Test** scene. HTML remains authoritative. WebGL is optional enhancement and cannot block navigation, content, forms, or case-study diagrams.

## Boundaries

- `apps/web`: App Router, server components by default, metadata, public routes, admin shell.
- `apps/api`: `/api/v1`, validation pipes, error envelope, Swagger, auth and projects modules.
- `packages/types`: transport-independent content and scene contracts.
- `packages/validation`: shared Zod validation and media safety policy.
- `packages/three`: quality degradation and scene-state contracts.
- `packages/game-engine`: pure deterministic game transitions and scoring; Phaser adapter comes later.
- `prisma`: database schema; no credentials or live data.

## Security decisions

Authentication is single-admin with no registration. Password verification uses Argon2id. Access tokens are short-lived; refresh sessions rotate and store only hashes. Refresh cookies are `HttpOnly`, `Secure` in production, `SameSite=Strict`, and scoped to auth routes. Login rate limiting, temporary lockout, session revocation, DTO validation, ownership guards, and audit events are contract requirements. Sprint 1 implements and tests the pure security interfaces; production credential provisioning is deliberately external.

Media is denied by default. Filename, extension, detected MIME, size, traversal, double extensions, SVG sanitization, and upload storage isolation are enforced before publication.

## Performance and accessibility

The quality ladder degrades DPR, particles, post-processing, shadows, transparency, model variant, animation, then WebGL. Sound defaults off. Reduced motion or WebGL failure exposes a static diagnostic diagram. The public DOM includes landmarks, skip navigation, visible focus, labelled controls, and normal links.

## ADRs

1. Use a procedural R3F greybox behind a stable `SystemSceneState` API; replace with GLB without page rewrites.
2. Keep Phaser out of homepage bundles; `game-engine` is pure TypeScript.
3. Store factual metrics as records with verification state, never decorative constants.
4. Keep placeholder media labelled and never present it as evidence.
5. Use Docker Compose PostgreSQL locally; staging/production databases are external and credential-driven.

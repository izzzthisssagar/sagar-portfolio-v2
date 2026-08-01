# Sprint 1 — Foundation

## Goal

Deliver a test-backed vertical foundation: semantic portfolio, adaptive procedural system scene, versioned API, content schema, secure admin contracts, project CRUD seam, and QA Rift rules.

## Acceptance evidence

- Fresh locked install succeeds.
- Formatting, lint, strict type checking, unit/API tests, and production builds pass.
- Public content works without WebGL and under reduced motion.
- Swagger is served at `/docs`; API resources are under `/api/v1`.
- No real credentials, fabricated evidence, or unlabelled media placeholders are committed.

## Explicit Sprint 1 limits

- The final GLB, KTX2 textures, project screenshots, CV, and approved portrait are not supplied.
- Docker/PostgreSQL runtime verification depends on Docker availability.
- Admin production login needs externally provisioned secrets and an Argon2 hash.
- Full CRUD persistence, media storage, email delivery, scroll choreography, and playable Phaser challenges are later vertical slices.

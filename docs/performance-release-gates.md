# Performance and accessibility release gates

Real Lighthouse measurements against a real production build, taken on 2026-08-04. These are lab
scores from one local run on one machine — not field data (no CrUX/RUM in this repo, see
`docs/sprint-4.md`'s "out of scope" list: no visitor-tracking analytics) — and are not portable
percentile guarantees. Treat them as a baseline to catch _regressions_, not as a promise of what a
real visitor's device/network will see.

## Methodology (reproduce exactly this way, not against `next dev`)

```bash
# 1. A real API instance, seeded, reachable at build time (see docs/deployment.md — /work,
#    /notes, and /sitemap.xml fetch their listing data at build time).
pnpm exec prisma migrate deploy
pnpm db:seed

# 2. A REAL PRODUCTION BUILD — never `next dev`. Lighthouse against dev-mode React (unminified,
#    HMR client, no production optimizations) produces meaningless numbers.
API_URL=http://127.0.0.1:4000 \
NEXT_PUBLIC_API_URL=http://127.0.0.1:4000/api/v1 \
PUBLIC_SITE_URL=http://127.0.0.1:3000 \
ALLOW_STATIC_CONTENT_FALLBACK=false \
pnpm --filter @portfolio/web build

# 3. The actual production entrypoint (output: 'standalone') — `next start` does not work with
#    a standalone build and silently mis-serves some routes (see the Known limitations /
#    findings section below).
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
NODE_ENV=production API_URL=http://127.0.0.1:4000 PUBLIC_SITE_URL=http://127.0.0.1:3000 \
  node apps/web/.next/standalone/apps/web/server.js

# 4. Lighthouse, headless, one page at a time (categories match what this doc tracks).
npx lighthouse http://127.0.0.1:3000/<path> \
  --output=json --output-path=<file> --chrome-flags="--headless" --quiet \
  --only-categories=performance,accessibility,best-practices,seo
```

## Baseline (2026-08-04, local run, production build)

| Page                                   | Perf | A11y | Best Practices | SEO | LCP    | CLS | TBT  | FCP   | JS transfer | Total transfer |
| -------------------------------------- | ---- | ---- | -------------- | --- | ------ | --- | ---- | ----- | ----------- | -------------- |
| Homepage (`/`)                         | 99   | 100  | 96             | 100 | 2163ms | 0   | 60ms | 755ms | 381KB       | 402KB          |
| About (`/about`)                       | 99   | 100  | 96             | 100 | 2168ms | 0   | 13ms | 755ms | 152KB       | 167KB          |
| Work index (`/work`)                   | 99   | 100  | 96             | 100 | 2162ms | 0   | 1ms  | 760ms | 152KB       | 169KB          |
| QA Mastery detail (`/work/qa-mastery`) | 99   | 100  | 96             | 100 | 2015ms | 0   | 5ms  | 756ms | 149KB       | 165KB          |
| Notes index (`/notes`)                 | 99   | 100  | 96             | 100 | 2162ms | 0   | 6ms  | 756ms | 149KB       | 163KB          |
| Contact (`/contact`)                   | 99   | 100  | 96             | 100 | 2167ms | 0   | 13ms | 754ms | 151KB       | 165KB          |

Homepage's JS transfer is meaningfully larger than every other page (381KB vs. ~150KB) — a single
~229KB chunk, almost certainly the hero's WebGL/3D scene bundle. Expected and not currently a
performance problem (homepage still scores 99), but it's the one number in this table most likely
to regress if 3D work in this app grows — watch it specifically, not just the aggregate.

## A real, severe bug this Lighthouse pass found and fixed

Every statically-prerendered page (`/work`, `/notes`, `/contact`, `/lab/qa-rift`, plus
`/work/[slug]` and `/notes/[slug]` specifically) 500'd or silently had every inline script blocked
by its own Content-Security-Policy in a **real production build** — invisible in this repo's
existing test suite because every e2e/unit test runs against `next dev`, which doesn't hit either
failure mode. Root cause: `proxy.ts` sets a fresh per-request CSP nonce via a request header on
every request; Next.js only threads that nonce onto its own framework-injected inline scripts
(hydration bootstrap, RSC payload) when the page is **dynamically** rendered — a statically
prerendered page bakes in whatever nonce existed at build time, which then never matches the real
per-request `Content-Security-Policy` header, and every CSP-enforcing browser (including
Lighthouse's real Chrome instance) blocks those scripts outright. Fixed by making every
HTML-rendering page dynamic (`export const dynamic = 'force-dynamic'`, or — for `/work/[slug]` and
`/notes/[slug]`, which already call `headers()` for `getNonce()` — by removing their
`generateStaticParams`, which forced a build-time-only static generation attempt that directly
conflicted with reading a dynamic API). The baseline numbers above are measured **after** this
fix. `docs/deployment.md` and the relevant page files carry the fuller explanation.

## Non-regression budgets

Set from the measured baseline with realistic headroom — not aspirational numbers this app hasn't
actually hit.

| Metric                          | Budget                                    | Rationale                                                                                                                                                |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance score               | ≥ 90 (any of the six pages)               | Baseline is 99 across the board; 90 gives real headroom before a genuine regression is missed.                                                           |
| Accessibility score             | 100, zero serious/critical axe violations | Baseline is 100 everywhere; this is a hard floor, not a target — see `tests/e2e/accessibility.spec.ts` for the same bar enforced across three viewports. |
| Best Practices score            | ≥ 90                                      | Baseline is 96; the two known gaps (missing favicon, missing source maps — see below) are minor and shouldn't regress further.                           |
| SEO score                       | 100                                       | Baseline is 100 everywhere.                                                                                                                              |
| CLS                             | ≤ 0.1                                     | Baseline is 0 everywhere; 0.1 is the standard "good" threshold, not a loosened bar.                                                                      |
| LCP                             | ≤ 3000ms                                  | Baseline sits around 2000-2200ms; 3000ms leaves headroom without ignoring a real regression.                                                             |
| JS transfer, non-homepage pages | ≤ 250KB                                   | Baseline ~150-152KB; catches an accidental large-dependency import before it ships.                                                                      |
| JS transfer, homepage           | ≤ 500KB                                   | Baseline 381KB, already includes the 3D hero bundle; catches runaway growth in that bundle specifically without blocking legitimate 3D work.             |
| Total transfer                  | ≤ 600KB (any of the six pages)            | Baseline tops out at 402KB (homepage); leaves room without being toothless.                                                                              |
| CSP-blocked console errors      | 0                                         | The bug above — a hard floor, not a budget with slack. Any reappearance means a new page was added statically without the dynamic-rendering fix.         |

## What these gates do NOT cover (known, honest limitations)

- **Lab data only, single machine, single run.** No CI-integrated Lighthouse CI server, no
  historical trend tracking, no field/CrUX data. A regression check here means "worse than this
  one baseline run," not "worse than what real visitors experience."
- **Interaction to Next Paint (INP)** isn't in this table — Lighthouse's lab environment can't
  produce a real INP value (it requires actual user interaction timing); Total Blocking Time (TBT,
  included above) is the standard lab proxy and is what's budgeted instead.
- **`/lab/qa-rift`** (the WebGL/3D page) is deliberately excluded from the required-page baseline
  table (Sprint 4 explicitly does not begin final GLB/scroll-choreography/playable-QA-Rift work —
  see `docs/sprint-4.md`) but received the same CSP dynamic-rendering fix, since that's a
  production-readiness bug fix, not new 3D feature work.
- **Missing favicon** (`errors-in-console`'s one remaining finding, a `favicon.ico` 404) and
  **missing source maps for large first-party JS** (`valid-source-maps`) are the two Best
  Practices gaps behind the 96/100 score. Both are minor, both are honestly left unfixed here — a
  favicon is portfolio-content/branding, not infrastructure, and out of this sprint's scope to
  fabricate; source maps are a build-config decision with a real tradeoff (debuggability vs.
  shipping source to every visitor) not settled here.
- **Reduced-motion and zoom-to-200% behavior** are not measured by Lighthouse at all — see
  `tests/e2e/accessibility.spec.ts` and the existing `tests/e2e/smoke.spec.ts` mobile-viewport
  coverage for what actually exercises those; this doc is Lighthouse-specific.
- **No visitor-tracking analytics** collects any of this in production, per Sprint 4's explicit
  scope — these numbers are a release-time developer check, never a live dashboard.

## CI

Lighthouse is not currently wired into `.github/workflows/ci.yml` as an automated gate — running
it requires a full production build + a real seeded database + a running standalone server, which
is straightforward locally (see Methodology above) but adds meaningful CI runtime and another
service dependency. Recorded here as a manual pre-release check for now; wiring an automated
Lighthouse CI gate (with the budgets above enforced as thresholds) is a reasonable Sprint 5
candidate once this baseline has been re-measured a few times and shown to be stable.

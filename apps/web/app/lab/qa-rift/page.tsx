// Forced dynamic — see the matching comment in apps/web/app/work/page.tsx: a per-request CSP
// nonce (proxy.ts) only reaches Next's own framework-injected inline scripts on dynamically
// rendered pages; a statically prerendered one bakes in a build-time nonce that never matches
// the real per-request CSP header, and CSP-enforcing browsers block those scripts outright.
export const dynamic = 'force-dynamic';

export default function Rift() {
  return (
    <main id="main" className="page-shell rift">
      <div className="container">
        <p className="eyebrow">QA Rift / Engine foundation</p>
        <h1 className="display">The release is unstable.</h1>
        <p className="lede">
          The typed state and scoring engine is ready. Phaser is intentionally lazy-loaded only when
          a playable challenge exists.
        </p>
        <h2>Modes</h2>
        <p>Quick Test / Release Run / Endless Defect / Calm Mode</p>
        <h2>Challenge registry</h2>
        <p>
          Visual Glitch Hunt / Logic Repair / API Shield / Accessibility Rescue / Performance Crisis
          / Security Breach / Release Boss
        </p>
      </div>
    </main>
  );
}

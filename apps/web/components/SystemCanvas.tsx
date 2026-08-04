'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { QUALITY_PROFILES } from '@portfolio/three';
import type { SystemSceneState } from '@portfolio/types';
import { useExperiencePreferences } from './ExperiencePreferences';
const Scene = dynamic(() => import('./SystemScene').then((module) => module.SystemScene), {
  ssr: false,
});
export function StaticSystemFallback({ reason = 'Static diagnostic view' }: { reason?: string }) {
  return (
    <div
      className="system-fallback"
      role="img"
      aria-label="System Under Test: layered interface, business logic, API, data, and security diagnostic machine"
    >
      <div>
        <div className="machine-diagram" />
        <p>{reason}</p>
      </div>
    </div>
  );
}
/** True for a software (CPU-emulated) WebGL renderer — SwiftShader (Chrome's own software
 * fallback, used by any Chrome instance with no real GPU, e.g. most CI/headless environments)
 * or Mesa's llvmpipe (the equivalent on Linux without a GPU driver). Uses the standard
 * `WEBGL_debug_renderer_info` extension to read the real (unmasked) renderer string; returns
 * false — never blocks the normal path — if that extension isn't exposed (some privacy-hardened
 * browsers disable it), since the cost of *not* detecting a slow software renderer is degraded
 * performance, not incorrect behavior. */
function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) return false;
    const renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    return renderer.includes('swiftshader') || renderer.includes('llvmpipe');
  } catch {
    return false;
  }
}
export function SystemCanvas({ state = 'sealed' }: { state?: SystemSceneState }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const { effectiveQuality, effectiveReducedMotion, degrade } = useExperiencePreferences();
  const slowFrames = useRef(0);
  // Deferred to the browser's idle time (not the next animation frame) deliberately — this is
  // the trigger for mounting the dynamically-imported Scene (SystemScene.tsx, the WebGL/Three.js
  // hero), and that mount is heavy enough (a real, measured multi-second main-thread block on a
  // *software* WebGL renderer specifically — see isSoftwareRenderer below) that starting it
  // immediately on paint competes directly with the page's own initial load/interactivity
  // window. Waiting for idle lets the page finish becoming interactive first; the visible
  // fallback (StaticSystemFallback) covers the gap. requestIdleCallback isn't in Safari — the
  // setTimeout fallback approximates the same "after the current work, not immediately"
  // deferral there.
  useEffect(() => {
    const detect = () => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        setAvailable(Boolean(gl));
        // A software renderer (no real GPU — most CI/headless environments) makes this scene's
        // default 'high' quality profile (shadows on, dpr 1.75) genuinely slow enough to block
        // the main thread for seconds, not milliseconds — the *reactive* slow-frame monitor
        // below exists for exactly this, but only degrades one step at a time after already
        // observing dropped frames, which is too late for a one-shot initialization cost this
        // large. Skip straight past every WebGL tier to the static fallback ('poster') instead,
        // proactively, for a software renderer specifically — a real user on one would get the
        // same unusably-slow scene these three `degrade()` calls are what the existing adaptive
        // system would eventually reach anyway, just too late to avoid the first bad paint.
        if (gl && isSoftwareRenderer(gl)) {
          degrade();
          degrade();
          degrade();
        }
      } catch {
        setAvailable(false);
      }
    };
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(detect, { timeout: 2000 });
      return () => cancelIdleCallback(handle);
    }
    const timeout = setTimeout(detect, 200);
    return () => clearTimeout(timeout);
  }, [degrade]);
  useEffect(() => {
    if (!available || effectiveReducedMotion) return;
    let previous = performance.now();
    let frame = 0;
    const monitor = (now: number) => {
      if (now - previous > 42) slowFrames.current += 1;
      else slowFrames.current = Math.max(0, slowFrames.current - 1);
      if (slowFrames.current > 45) {
        degrade();
        slowFrames.current = 0;
      }
      previous = now;
      frame = requestAnimationFrame(monitor);
    };
    frame = requestAnimationFrame(monitor);
    return () => cancelAnimationFrame(frame);
  }, [available, effectiveReducedMotion, degrade]);
  if (available !== true || effectiveQuality === 'poster')
    return (
      <StaticSystemFallback
        reason={
          available === false
            ? 'WebGL unavailable — static system map'
            : effectiveQuality === 'poster'
              ? 'Performance fallback — static system map'
              : 'Preparing diagnostic view'
        }
      />
    );
  return (
    <Scene
      state={state}
      profile={QUALITY_PROFILES[effectiveQuality]}
      reducedMotion={effectiveReducedMotion}
      onContextLost={() => setAvailable(false)}
    />
  );
}

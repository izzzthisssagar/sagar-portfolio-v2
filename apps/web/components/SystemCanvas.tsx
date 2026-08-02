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
export function SystemCanvas({ state = 'sealed' }: { state?: SystemSceneState }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const { effectiveQuality, effectiveReducedMotion, degrade } = useExperiencePreferences();
  const slowFrames = useRef(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const canvas = document.createElement('canvas');
        setAvailable(Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')));
      } catch {
        setAvailable(false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
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

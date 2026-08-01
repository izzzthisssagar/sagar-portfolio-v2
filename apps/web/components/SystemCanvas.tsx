'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { SystemSceneState } from '@portfolio/types';
const Scene = dynamic(() => import('./SystemScene').then((m) => m.SystemScene), { ssr: false });
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
  if (available !== true)
    return (
      <StaticSystemFallback
        reason={
          available === false
            ? 'WebGL unavailable — static system map'
            : 'Preparing diagnostic view'
        }
      />
    );
  return <Scene state={state} />;
}

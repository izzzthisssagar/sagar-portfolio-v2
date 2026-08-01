'use client';
import Link from 'next/link';
import { useState } from 'react';
export function SiteHeader() {
  const [sound, setSound] = useState(false);
  const [motion, setMotion] = useState<'auto' | 'reduced'>('auto');
  const [quality, setQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');
  return (
    <header className="site-header">
      <nav className="container nav" aria-label="Primary">
        <Link className="brand" href="/">
          SAGAR THAPA
        </Link>
        <div className="nav-links">
          <Link href="/work">WORK</Link>
          <Link href="/notes">NOTES</Link>
          <Link href="/about">ABOUT</Link>
          <Link href="/lab/qa-rift">LAB</Link>
          <Link href="/contact">CONTACT</Link>
        </div>
        <div className="utilities" aria-label="Experience preferences">
          <button className="utility" onClick={() => setSound(!sound)}>
            Sound {sound ? 'On' : 'Off'}
          </button>
          <button
            className="utility"
            onClick={() => setMotion(motion === 'auto' ? 'reduced' : 'auto')}
          >
            Motion {motion === 'auto' ? 'Auto' : 'Reduced'}
          </button>
          <button
            className="utility"
            onClick={() =>
              setQuality(
                quality === 'auto'
                  ? 'high'
                  : quality === 'high'
                    ? 'medium'
                    : quality === 'medium'
                      ? 'low'
                      : 'auto',
              )
            }
          >
            Quality {{ auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' }[quality]}
          </button>
        </div>
      </nav>
    </header>
  );
}

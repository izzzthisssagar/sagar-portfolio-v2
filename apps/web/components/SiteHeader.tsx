'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useExperiencePreferences } from './ExperiencePreferences';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { sound, motion, quality, setSound, setMotion, setQuality } = useExperiencePreferences();
  const nextQuality = { auto: 'high', high: 'medium', medium: 'low', low: 'auto' } as const;
  return (
    <header className="site-header">
      <nav className="container nav" aria-label="Primary">
        <Link className="brand" href="/">
          SAGAR THAPA
        </Link>
        <button
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="primary-links"
          onClick={() => setOpen(!open)}
        >
          MENU
        </button>
        <div className="nav-links" id="primary-links" data-open={open}>
          <Link href="/work">WORK</Link>
          <Link href="/notes">NOTES</Link>
          <Link href="/about">ABOUT</Link>
          <Link href="/lab/qa-rift">LAB</Link>
          <Link href="/contact">CONTACT</Link>
        </div>
        <div className="utilities" aria-label="Experience preferences">
          <button className="utility" aria-pressed={sound} onClick={() => setSound(!sound)}>
            Sound {sound ? 'On' : 'Off'}
          </button>
          <button
            className="utility"
            aria-pressed={motion === 'reduced'}
            onClick={() => setMotion(motion === 'auto' ? 'reduced' : 'auto')}
          >
            Motion {motion === 'auto' ? 'Auto' : 'Reduced'}
          </button>
          <button className="utility" onClick={() => setQuality(nextQuality[quality])}>
            Quality {{ auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' }[quality]}
          </button>
        </div>
      </nav>
    </header>
  );
}

import type { Metadata } from 'next';
import { ContactForm } from '@/components/ContactForm';

// Forced dynamic — see the matching comment in apps/web/app/work/page.tsx: a per-request CSP
// nonce (proxy.ts) only reaches Next's own framework-injected inline scripts on dynamically
// rendered pages; a statically prerendered one bakes in a build-time nonce that never matches
// the real per-request CSP header, and CSP-enforcing browsers block those scripts outright.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Start a conversation about a testing problem, a role, or a project.',
  alternates: { canonical: '/contact' },
};

export default function Contact() {
  return (
    <main id="main" className="page-shell">
      <div className="container">
        <p className="eyebrow">Contact</p>
        <h1 className="display">Start with context.</h1>
        <ContactForm />
      </div>
    </main>
  );
}

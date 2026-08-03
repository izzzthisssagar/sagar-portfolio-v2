import type { Metadata } from 'next';
import { ContactForm } from '@/components/ContactForm';

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

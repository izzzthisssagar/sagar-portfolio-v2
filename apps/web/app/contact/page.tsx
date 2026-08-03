import { ContactForm } from '@/components/ContactForm';

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

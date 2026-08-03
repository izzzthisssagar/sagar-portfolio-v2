'use client';

import { useState } from 'react';
import { ContactSubmitError, submitContact } from '@/lib/contact-client';
import {
  emptyContactFormValues,
  validateContactForm,
  type ContactFormErrors,
  type ContactFormValues,
} from '@/lib/contact-form-validation';

export function ContactForm() {
  const [values, setValues] = useState<ContactFormValues>(emptyContactFormValues);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [serverError, setServerError] = useState<string | null>(null);

  function set<K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return; // duplicate-submission protection
    const nextErrors = validateContactForm(values);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setStatus('submitting');
    try {
      await submitContact({
        name: values.name,
        email: values.email,
        message: values.message,
        ...(values.subject ? { subject: values.subject } : {}),
        ...(values.company ? { company: values.company } : {}),
        ...(values.website ? { website: values.website } : {}),
      });
      setStatus('success');
      // Content is only cleared once the API has actually confirmed persistence — a recoverable
      // failure below leaves everything the visitor typed in place.
      setValues(emptyContactFormValues);
    } catch (error) {
      setStatus('error');
      setServerError(error instanceof ContactSubmitError ? error.message : 'Could not send your message. Try again.');
    }
  }

  if (status === 'success') {
    return (
      <p role="status" className="contact-success">
        Message received. I read every message and reply from my own inbox — there is no
        auto-reply, so expect a personal response.
      </p>
    );
  }

  return (
    <form className="login" onSubmit={onSubmit} noValidate>
      {serverError && (
        <p role="alert" className="server-error">
          {serverError}
        </p>
      )}
      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
          aria-describedby={errors.name ? 'name-error' : undefined}
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name && (
          <span id="name-error" className="field-error">
            {errors.name}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={values.email}
          onChange={(event) => set('email', event.target.value)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email && (
          <span id="email-error" className="field-error">
            {errors.email}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="subject">Subject (optional)</label>
        <input
          id="subject"
          name="subject"
          autoComplete="off"
          value={values.subject}
          onChange={(event) => set('subject', event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="company">Company (optional)</label>
        <input
          id="company"
          name="company"
          autoComplete="organization"
          value={values.company}
          onChange={(event) => set('company', event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="message">Message</label>
        <textarea
          id="message"
          name="message"
          rows={7}
          required
          value={values.message}
          onChange={(event) => set('message', event.target.value)}
          aria-describedby={errors.message ? 'message-error' : undefined}
          aria-invalid={Boolean(errors.message)}
        />
        {errors.message && (
          <span id="message-error" className="field-error">
            {errors.message}
          </span>
        )}
      </div>
      {/* Honeypot — hidden visually and from assistive tech, not via type="hidden" (which some
          bots skip filling), and never presented to a real visitor. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="website">Leave this field empty</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => set('website', event.target.value)}
        />
      </div>
      <button className="button primary" type="submit" disabled={status === 'submitting'} aria-busy={status === 'submitting'}>
        {status === 'submitting' ? 'SENDING…' : 'SEND'}
      </button>
    </form>
  );
}

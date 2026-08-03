import { describe, expect, it } from 'vitest';
import { emptyContactFormValues, validateContactForm } from './contact-form-validation';

const valid = {
  ...emptyContactFormValues,
  name: 'Jane',
  email: 'jane@example.com',
  message: 'Hello.',
};

describe('validateContactForm', () => {
  it('accepts a fully valid form', () => {
    expect(validateContactForm(valid)).toEqual({});
  });

  it('requires a name', () => {
    expect(validateContactForm({ ...valid, name: '  ' }).name).toBeDefined();
  });

  it('requires a valid email', () => {
    expect(validateContactForm({ ...valid, email: 'not-an-email' }).email).toBeDefined();
  });

  it('requires a message', () => {
    expect(validateContactForm({ ...valid, message: '' }).message).toBeDefined();
  });
});

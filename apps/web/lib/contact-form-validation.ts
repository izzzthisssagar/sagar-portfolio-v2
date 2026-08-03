export interface ContactFormValues {
  name: string;
  email: string;
  subject: string;
  company: string;
  message: string;
  website: string;
}

export const emptyContactFormValues: ContactFormValues = {
  name: '',
  email: '',
  subject: '',
  company: '',
  message: '',
  website: '',
};

export type ContactFormErrors = Partial<Record<keyof ContactFormValues, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactForm(values: ContactFormValues): ContactFormErrors {
  const errors: ContactFormErrors = {};
  if (!values.name.trim()) errors.name = 'Name is required.';
  if (!EMAIL_PATTERN.test(values.email)) errors.email = 'Enter a valid email address.';
  if (!values.message.trim()) errors.message = 'Message is required.';
  return errors;
}

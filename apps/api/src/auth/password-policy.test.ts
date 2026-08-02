import { describe, expect, it } from 'vitest';
import { validatePasswordStrength } from './password-policy';

describe('password strength policy', () => {
  it('rejects passwords shorter than the minimum length', () => {
    expect(validatePasswordStrength('Short1!').ok).toBe(false);
  });
  it('rejects a common password even at sufficient length', () => {
    expect(validatePasswordStrength('password123456').ok).toBe(false);
  });
  it('rejects a long password using only one character class', () => {
    expect(validatePasswordStrength('aaaaaaaaaaaaaaaaaaa').ok).toBe(false);
  });
  it('accepts a password combining three character classes', () => {
    expect(validatePasswordStrength('Correct-Horse-9').ok).toBe(true);
  });
  it('accepts a long passphrase without symbols or digits', () => {
    expect(validatePasswordStrength('correct horse battery staple word').ok).toBe(true);
  });
});

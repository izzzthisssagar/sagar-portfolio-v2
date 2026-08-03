export const MIN_PASSWORD_LENGTH = 12;
export const PASSPHRASE_LENGTH = 20;

const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  'password1234',
  'passw0rd123456',
  'letmein12345',
  'qwertyuiop123',
  'admin12345678',
  'administrator1',
  '123456789012',
  '1234567890123',
  'welcome123456',
  'iloveyou12345',
  'trustno112345',
  'changeme12345',
  'temporary12345',
]);

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

function characterClassCount(password: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  return classes.reduce((count, pattern) => count + (pattern.test(password) ? 1 : 0), 0);
}

export function validatePasswordStrength(password: string): PasswordPolicyResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: 'Password is too common.' };
  }
  const isLongPassphrase = password.length >= PASSPHRASE_LENGTH;
  if (!isLongPassphrase && characterClassCount(password) < 3) {
    return {
      ok: false,
      reason:
        'Password must combine at least 3 of: lowercase, uppercase, digits, symbols — or be a 20+ character passphrase.',
    };
  }
  return { ok: true };
}

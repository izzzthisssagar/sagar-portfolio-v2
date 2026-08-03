import * as argon2 from 'argon2';
import { isValidEmail, normalizeEmail } from '../auth/email';
import { validatePasswordStrength } from '../auth/password-policy';
import type { PrismaService } from '../prisma/prisma.service';

export class InvalidEmailError extends Error {}
export class WeakPasswordError extends Error {}
export class AdminAlreadyExistsError extends Error {
  constructor() {
    super(
      'An administrator already exists. Single-administrator systems cannot be re-provisioned.',
    );
  }
}

export interface ProvisionAdminInput {
  prisma: Pick<PrismaService, 'adminUser' | 'auditLog'>;
  email: string;
  password: string;
}

export interface ProvisionedAdmin {
  id: string;
  email: string;
}

/**
 * Creates the single administrator row. Never logs the password or the
 * password hash — callers (the CLI entrypoint) must not print `password`
 * or the returned admin's hash, and this function does not return a hash.
 */
export async function provisionAdmin({
  prisma,
  email,
  password,
}: ProvisionAdminInput): Promise<ProvisionedAdmin> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new InvalidEmailError(`"${email}" is not a valid email address.`);
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    throw new WeakPasswordError(strength.reason ?? 'Password does not meet the strength policy.');
  }

  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    throw new AdminAlreadyExistsError();
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.adminUser.create({
    data: { email: normalized, passwordHash },
  });
  await prisma.auditLog.create({
    data: {
      action: 'ADMIN_CREATED',
      resource: 'AdminUser',
      resourceId: admin.id,
      actorId: admin.id,
    },
  });
  return { id: admin.id, email: admin.email };
}

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminAlreadyExistsError,
  InvalidEmailError,
  WeakPasswordError,
  provisionAdmin,
} from './admin-provisioning';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;

databaseSuite('admin provisioning', () => {
  const prisma = new PrismaService();
  const email = 'provisioning-test-admin@example.invalid';
  const strongPassword = 'Correct-Horse-Battery-9!';

  beforeEach(async () => {
    await prisma.$connect();
    await prisma.auditLog.deleteMany({});
    await prisma.adminUser.deleteMany({});
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.adminUser.deleteMany({});
    await prisma.$disconnect();
  });

  it('creates the first administrator with an argon2id hash and an audit record', async () => {
    const admin = await provisionAdmin({ prisma, email, password: strongPassword });
    expect(admin.email).toBe(email.toLowerCase());

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row.passwordHash).not.toBe(strongPassword);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { resourceId: admin.id } });
    expect(audit?.action).toBe('ADMIN_CREATED');
  });

  it('rejects a second administrator once one exists', async () => {
    await provisionAdmin({ prisma, email, password: strongPassword });
    await expect(
      provisionAdmin({ prisma, email: 'second-admin@example.invalid', password: strongPassword }),
    ).rejects.toBeInstanceOf(AdminAlreadyExistsError);
  });

  it('rejects an invalid email before touching the database', async () => {
    await expect(
      provisionAdmin({ prisma, email: 'not-an-email', password: strongPassword }),
    ).rejects.toBeInstanceOf(InvalidEmailError);
    expect(await prisma.adminUser.count()).toBe(0);
  });

  it('rejects a weak password before touching the database', async () => {
    await expect(
      provisionAdmin({ prisma, email, password: 'short1' }),
    ).rejects.toBeInstanceOf(WeakPasswordError);
    expect(await prisma.adminUser.count()).toBe(0);
  });
});

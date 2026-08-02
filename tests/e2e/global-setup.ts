import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
import { provisionAdmin } from '../../apps/api/src/provisioning/admin-provisioning';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './test-admin';

/**
 * Resets the single AdminUser row to a known test administrator before the
 * Playwright suite runs, so login/session/CMS specs have real credentials
 * to exercise against the real API and database — not a bypass token.
 */
export default async function globalSetup() {
  if (!process.env.DATABASE_URL) return;
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await prisma.refreshSession.deleteMany({});
    await prisma.adminUser.deleteMany({});
    await provisionAdmin({ prisma, email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD });
  } finally {
    await prisma.$disconnect();
  }
}

import 'dotenv/config';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';
import { seedContent } from './seed-content';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await seedContent(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

void main();

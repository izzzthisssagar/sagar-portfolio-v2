import 'dotenv/config';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';

/**
 * Idempotent development content seed. Only supplied, factual project
 * content goes here — no invented metrics, screenshots, or outcomes. Safe
 * to run repeatedly: each project's own metrics/findings are replaced
 * wholesale on every run rather than accumulated.
 */

const qaMastery = {
  slug: 'qa-mastery',
  title: 'QA Mastery',
  summary:
    "Don't watch testing. Do it. An independently conceived QA learning platform connecting curriculum, practice, grading, and release gates.",
  overview:
    'QA Mastery is an independently conceived and directed product by Sagar Thapa. I am the ' +
    'sole human creator and product owner, responsible for the product vision, requirements, ' +
    'architecture decisions, testing direction, iterative evaluation, and release decisions. I ' +
    'used substantial AI coding assistance during research, implementation, debugging, ' +
    'documentation, and refinement. The platform remains under active development.',
  responsibilities:
    'Product vision, requirements, architecture decisions, testing direction, iterative ' +
    'evaluation, and release decisions.',
  systemMap:
    'Platform / Curriculum / Interactive Widgets / Automated Grading / BuggyShop / BuggyAPI / AI Tutor / Supabase / CI / Release Gate',
  liveUrl: 'https://qa-mastery-platform.vercel.app/',
  githubUrl: 'https://github.com/izzzthisssagar/qa-mastery',
  labels: [
    'Platform',
    'Curriculum',
    'Interactive Widgets',
    'Automated Grading',
    'BuggyShop',
    'BuggyAPI',
    'AI Tutor',
    'Supabase',
    'CI / Release Gate',
  ],
  sceneState: 'mastery',
  status: 'PUBLISHED' as const,
  publishedAt: new Date(),
  order: 1,
  metrics: [
    { label: 'Cross-linked notes', value: '876+', evidence: 'CONFIRMED' as const, order: 0 },
    { label: 'Modules', value: '48', evidence: 'CONFIRMED' as const, order: 1 },
    { label: 'Workspaces', value: '13', evidence: 'CONFIRMED' as const, order: 2 },
    { label: 'Practice surfaces', value: '3', evidence: 'CONFIRMED' as const, order: 3 },
  ],
  findings: [] as const,
};

const numazuHalalFood = {
  slug: 'numazu-halal-food',
  title: 'Numazu Halal Food',
  summary:
    'Checkout and commerce quality investigation, including a known duplicate-discount calculation defect.',
  overview:
    'Checkout total is derived as MRP − discount + shipping + VAT = total. This project tracks ' +
    'an investigation into a discrepancy between the expected and actual checkout total.',
  testStrategy:
    'Compare Expected, Actual, and Fixed totals against the MRP − discount + shipping + VAT ' +
    'formula across representative cart states.',
  sceneState: 'fault',
  status: 'DRAFT' as const,
  order: 2,
  metrics: [] as const,
  findings: [
    {
      title: 'Double discount applied at checkout',
      summary:
        'A product-level discount was reflected in the displayed price, then the discount ' +
        'amount was applied again during checkout, causing the calculated total to be lower ' +
        'than expected.',
      severity: 'High' as const,
      evidenceStatus: 'PENDING' as const,
      order: 0,
    },
  ],
};

async function seedProject(
  prisma: PrismaService,
  input: typeof qaMastery | typeof numazuHalalFood,
) {
  const { metrics, findings, ...projectFields } = input;
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.upsert({
      where: { slug: input.slug },
      create: projectFields,
      update: projectFields,
    });
    await tx.projectMetric.deleteMany({ where: { projectId: project.id } });
    await tx.projectFinding.deleteMany({ where: { projectId: project.id } });
    if (metrics.length) {
      await tx.projectMetric.createMany({
        data: metrics.map((metric) => ({ ...metric, projectId: project.id })),
      });
    }
    if (findings.length) {
      await tx.projectFinding.createMany({
        data: findings.map((finding) => ({ ...finding, projectId: project.id })),
      });
    }
  });
  console.log(`Seeded ${input.slug} (${input.status}).`);
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await seedProject(prisma, qaMastery);
    await seedProject(prisma, numazuHalalFood);
  } finally {
    await prisma.$disconnect();
  }
}

void main();

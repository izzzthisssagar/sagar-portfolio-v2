import { PrismaService } from '../apps/api/src/prisma/prisma.service';

/**
 * Idempotent development content seed. Only supplied, factual project
 * content goes here — no invented metrics, screenshots, or outcomes. Safe
 * to run repeatedly: each project's own metrics/findings are replaced
 * wholesale on every run rather than accumulated.
 *
 * Side-effect-free on import (no CLI entrypoint here) so it can be imported
 * directly by both `prisma/seed.ts` (the `db:seed` CLI) and
 * `tests/e2e/global-setup.ts` (Playwright) without either accidentally
 * re-running it or fighting over module-system entrypoint detection.
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

export async function seedProject(
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

/**
 * Migrates the four static Field Notes seed articles from
 * `apps/web/lib/content.ts` into `BlogPost` rows, verbatim — same title,
 * slug, excerpt, and body text the static array already held (all four are
 * placeholder "draft seed" copy, since no real article content exists yet;
 * this is not invented content, it's the same placeholder text moved to the
 * database). Every static article had `status: 'draft'`, so every migrated
 * row starts `DRAFT` too — nothing here becomes publicly visible until an
 * administrator reviews and publishes it through the CMS.
 *
 * `category` (free string in the static shape) has no equivalent BlogPost
 * field — the schema uses a relational `BlogCategory` instead — so a single
 * "Field Notes" category is upserted and every migrated post is attached to
 * it. `tags` (`['draft']` in the static shape) maps onto relational
 * `BlogTag` rows the same way. `readingTime`/`relatedProjects`/
 * `relatedArticles` have no meaningful source data (all identical/empty
 * across every article) and are left at their schema defaults rather than
 * carrying over placeholder numbers as if they were measured.
 */
const fieldNotesArticles = [
  {
    title: 'Testing an OTP flow beyond the happy path',
    slug: 'testing-otp-beyond-happy-path',
  },
  {
    title: 'Why a correct-looking checkout total can be wrong',
    slug: 'checkout-total-can-be-wrong',
  },
  {
    title: 'Reading P95 and P99 without guessing',
    slug: 'reading-p95-p99',
  },
  {
    title: 'Building QA Mastery through repeated iteration',
    slug: 'building-qa-mastery',
  },
].map((article, index) => ({
  ...article,
  excerpt: 'Draft seed — article content is not yet published.',
  body: 'Draft seed content. This is a content-model placeholder, not a finished article.',
  seoTitle: article.title,
  seoDescription: 'Draft seed article.',
  displayOrder: index,
}));

export async function seedPosts(prisma: PrismaService) {
  await prisma.$transaction(async (tx) => {
    const category = await tx.blogCategory.upsert({
      where: { slug: 'field-notes' },
      update: {},
      create: { slug: 'field-notes', name: 'Field Notes' },
    });
    const draftTag = await tx.blogTag.upsert({
      where: { slug: 'draft' },
      update: {},
      create: { slug: 'draft', name: 'draft' },
    });
    for (const article of fieldNotesArticles) {
      await tx.blogPost.upsert({
        where: { slug: article.slug },
        update: {
          title: article.title,
          excerpt: article.excerpt,
          body: article.body,
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          displayOrder: article.displayOrder,
          categoryId: category.id,
          tags: { set: [{ id: draftTag.id }] },
        },
        create: {
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt,
          body: article.body,
          readingTime: 1,
          author: 'Sagar Thapa',
          status: 'DRAFT',
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          displayOrder: article.displayOrder,
          categoryId: category.id,
          tags: { connect: [{ id: draftTag.id }] },
        },
      });
    }
  });
  console.log(`Seeded ${fieldNotesArticles.length} Field Notes article(s) (draft).`);
}

/** Reused directly by the Playwright global setup, and by the `db:seed`
 * CLI entrypoint (`prisma/seed.ts`) — both need the exact same idempotent
 * seed. */
export async function seedContent(prisma: PrismaService) {
  await seedProject(prisma, qaMastery);
  await seedProject(prisma, numazuHalalFood);
  await seedPosts(prisma);
}

import type { ArticleRecord, ProjectRecord } from '@portfolio/types';
export const projects: ProjectRecord[] = [
  {
    id: '01',
    slug: 'qa-mastery',
    order: 1,
    title: 'QA Mastery',
    summary:
      'An independently conceived QA learning platform connecting curriculum, practice, grading, and release gates.',
    status: 'published',
    sceneState: 'mastery',
    metrics: [
      { label: 'Cross-linked notes', value: '876+', evidence: 'confirmed' },
      { label: 'Modules', value: '48', evidence: 'confirmed' },
      { label: 'Workspaces', value: '13', evidence: 'confirmed' },
      { label: 'Practice surfaces', value: '3', evidence: 'confirmed' },
    ],
  },
  {
    id: '02',
    slug: 'numazu-halal-food',
    order: 2,
    title: 'Numazu Halal Food',
    summary:
      'Checkout and commerce quality investigation, including a known duplicate-discount calculation defect.',
    status: 'draft',
    sceneState: 'fault',
    metrics: [],
  },
  {
    id: '03',
    slug: 'api-security-testing',
    order: 3,
    title: 'API Security Program',
    summary:
      'Authentication, authorization, negative testing, and ownership enforcement exercises.',
    status: 'draft',
    sceneState: 'inspection',
    metrics: [],
  },
  {
    id: '04',
    slug: 'performance-testing',
    order: 4,
    title: 'Performance Lab',
    summary:
      'Latency distributions, long-tail behavior, and bottleneck analysis without average-based guesswork.',
    status: 'draft',
    sceneState: 'inspection',
    metrics: [],
  },
  {
    id: '05',
    slug: 'automation-testing',
    order: 5,
    title: 'Automation Lab',
    summary: 'A tested path from browser action through evidence capture and defect reporting.',
    status: 'draft',
    sceneState: 'verified',
    metrics: [],
  },
];
export const notes: ArticleRecord[] = [
  'Testing an OTP flow beyond the happy path',
  'Why a correct-looking checkout total can be wrong',
  'Reading P95 and P99 without guessing',
  'Building QA Mastery through repeated iteration',
].map((title, index) => ({
  title,
  slug: [
    'testing-otp-beyond-happy-path',
    'checkout-total-can-be-wrong',
    'reading-p95-p99',
    'building-qa-mastery',
  ][index]!,
  excerpt: 'Draft seed — article content is not yet published.',
  body: 'Draft seed content. This is a content-model placeholder, not a finished article.',
  category: 'Field Notes',
  tags: ['draft'],
  readingTime: 1,
  author: 'Sagar Thapa',
  status: 'draft',
  seoTitle: title,
  seoDescription: 'Draft seed article.',
  relatedProjects: [],
  relatedArticles: [],
}));
export const caseStudySections = [
  'Overview',
  'Context',
  'Responsibilities',
  'System map',
  'Test strategy',
  'Important findings',
  'Evidence',
  'Fix and retest',
  'Outcome',
  'Lessons and future improvements',
];

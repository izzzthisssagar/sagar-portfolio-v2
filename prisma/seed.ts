// Seed intentionally contains only supplied facts and clearly labelled draft records.
export const draftProjects = [
  { slug: 'qa-mastery', title: 'QA Mastery', status: 'PUBLISHED', order: 1 },
  { slug: 'numazu-halal-food', title: 'Numazu Halal Food', status: 'DRAFT', order: 2 },
  { slug: 'api-security-testing', title: 'API Security Program', status: 'DRAFT', order: 3 },
  { slug: 'performance-testing', title: 'Performance Lab', status: 'DRAFT', order: 4 },
  { slug: 'automation-testing', title: 'Automation Lab', status: 'DRAFT', order: 5 },
] as const;

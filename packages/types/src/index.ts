export type SystemSceneState =
  | 'sealed'
  | 'exploded'
  | 'mastery'
  | 'inspection'
  | 'fault'
  | 'verified'
  | 'rift';
export type PublicationStatus = 'draft' | 'review' | 'published' | 'archived';
export type EvidenceState = 'confirmed' | 'pending' | 'unavailable';

export interface ProjectMetric {
  id?: string;
  label: string;
  value: string;
  evidence: EvidenceState;
  sourceNote?: string | null;
  order?: number;
}
export const FINDING_SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export interface ProjectFinding {
  id?: string;
  title: string;
  summary: string;
  severity?: FindingSeverity | null;
  evidenceStatus: EvidenceState;
  order?: number;
}
export interface ProjectRecord {
  id: string;
  slug: string;
  order: number;
  title: string;
  summary: string;
  status: PublicationStatus;
  sceneState: SystemSceneState;
  metrics: ProjectMetric[];
}
export interface ProjectEvidence {
  id?: string;
  title?: string | null;
  caption?: string | null;
  altText?: string | null;
  sourceNote?: string | null;
  evidenceStatus: EvidenceState;
  order?: number;
  mediaId?: string;
}
export interface ProjectDetailRecord extends ProjectRecord {
  overview?: string | null;
  context?: string | null;
  responsibilities?: string | null;
  systemMap?: string | null;
  testStrategy?: string | null;
  fixAndRetest?: string | null;
  outcome?: string | null;
  lessons?: string | null;
  liveUrl?: string | null;
  githubUrl?: string | null;
  labels?: string[];
  publishedAt?: string | null;
  findings: ProjectFinding[];
  evidence?: ProjectEvidence[];
}

export interface ArticleRecord {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string[];
  featuredImage?: string;
  readingTime: number;
  author: string;
  status: PublicationStatus;
  publishedDate?: string;
  seoTitle: string;
  seoDescription: string;
  socialImage?: string;
  relatedProjects: string[];
  relatedArticles: string[];
}

/** Database-backed Field Notes article, distinct from the legacy static `ArticleRecord` seed
 * shape above (which `apps/web/lib/content.ts` still holds as the fallback/seed source). */
export interface PostRecord {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  status: PublicationStatus;
  publishedAt?: string | null;
  readingTime: number;
  author: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  canonicalUrl?: string | null;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

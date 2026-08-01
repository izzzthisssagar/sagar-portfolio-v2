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
  label: string;
  value: string;
  evidence: EvidenceState;
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

export interface ApiErrorEnvelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

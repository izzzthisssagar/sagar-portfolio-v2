export type QualityLevel = 'high' | 'medium' | 'low' | 'poster';
export interface QualityProfile {
  level: QualityLevel;
  dpr: number;
  particles: number;
  postprocessing: boolean;
  shadows: boolean;
  transparency: boolean;
  model: 'desktop' | 'mobile' | 'poster';
  animateIdle: boolean;
}
export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  high: {
    level: 'high',
    dpr: 1.75,
    particles: 60,
    postprocessing: false,
    shadows: true,
    transparency: true,
    model: 'desktop',
    animateIdle: true,
  },
  medium: {
    level: 'medium',
    dpr: 1.25,
    particles: 24,
    postprocessing: false,
    shadows: false,
    transparency: true,
    model: 'desktop',
    animateIdle: true,
  },
  low: {
    level: 'low',
    dpr: 1,
    particles: 0,
    postprocessing: false,
    shadows: false,
    transparency: false,
    model: 'mobile',
    animateIdle: false,
  },
  poster: {
    level: 'poster',
    dpr: 1,
    particles: 0,
    postprocessing: false,
    shadows: false,
    transparency: false,
    model: 'poster',
    animateIdle: false,
  },
};
export function degradeQuality(level: QualityLevel): QualityLevel {
  return ({ high: 'medium', medium: 'low', low: 'poster', poster: 'poster' } as const)[level];
}

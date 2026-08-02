import type { SystemSceneState } from '@portfolio/types';
import type { QualityProfile } from '@portfolio/three';

export const SYSTEM_LAYERS = [
  'interface',
  'business logic',
  'API and authentication',
  'data and state',
  'security and performance',
] as const;
export interface SceneTransform {
  spread: number;
  rotation: [number, number, number];
  ringScale: number;
  faultLayer: number | null;
  verified: boolean;
  fracture: number;
}
export const SCENE_TRANSFORMS: Record<SystemSceneState, SceneTransform> = {
  sealed: {
    spread: 0.42,
    rotation: [0.35, -0.45, 0],
    ringScale: 1,
    faultLayer: null,
    verified: false,
    fracture: 0,
  },
  exploded: {
    spread: 1.05,
    rotation: [0.28, -0.3, 0],
    ringScale: 1.15,
    faultLayer: null,
    verified: false,
    fracture: 0,
  },
  mastery: {
    spread: 1.45,
    rotation: [0.1, 0.15, 0],
    ringScale: 1.55,
    faultLayer: null,
    verified: false,
    fracture: 0,
  },
  inspection: {
    spread: 0.72,
    rotation: [0.15, -0.7, 0],
    ringScale: 1.25,
    faultLayer: null,
    verified: false,
    fracture: 0,
  },
  fault: {
    spread: 0.9,
    rotation: [0.42, -0.55, 0.08],
    ringScale: 1.35,
    faultLayer: 3,
    verified: false,
    fracture: 0,
  },
  verified: {
    spread: 0.58,
    rotation: [0.2, -0.25, 0],
    ringScale: 1.2,
    faultLayer: null,
    verified: true,
    fracture: 0,
  },
  rift: {
    spread: 1.8,
    rotation: [0.55, 0.35, 0.18],
    ringScale: 2.1,
    faultLayer: 2,
    verified: false,
    fracture: 0.8,
  },
};
export const shouldAnimateScene = (profile: QualityProfile, reducedMotion: boolean) =>
  profile.animateIdle && !reducedMotion;

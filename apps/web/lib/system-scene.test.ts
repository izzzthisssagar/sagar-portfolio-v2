import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES } from '@portfolio/three';
import { SCENE_TRANSFORMS, shouldAnimateScene, SYSTEM_LAYERS } from './system-scene';

describe('System Under Test scene contract', () => {
  it('models the five meaningful quality layers', () =>
    expect(SYSTEM_LAYERS).toEqual([
      'interface',
      'business logic',
      'API and authentication',
      'data and state',
      'security and performance',
    ]));
  it('gives every scene state a distinct visible transformation', () => {
    const states = [
      'sealed',
      'exploded',
      'mastery',
      'inspection',
      'fault',
      'verified',
      'rift',
    ] as const;
    expect(Object.keys(SCENE_TRANSFORMS)).toEqual(states);
    expect(new Set(states.map((state) => JSON.stringify(SCENE_TRANSFORMS[state]))).size).toBe(
      states.length,
    );
  });
  it('stops idle animation under reduced motion', () => {
    expect(shouldAnimateScene(QUALITY_PROFILES.high, false)).toBe(true);
    expect(shouldAnimateScene(QUALITY_PROFILES.high, true)).toBe(false);
    expect(shouldAnimateScene(QUALITY_PROFILES.low, false)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { degradeQuality } from './index';
describe('quality degradation', () => {
  it('degrades deterministically to poster', () => {
    expect(degradeQuality(degradeQuality(degradeQuality('high')))).toBe('poster');
    expect(degradeQuality('poster')).toBe('poster');
  });
});

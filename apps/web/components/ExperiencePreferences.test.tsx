import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExperiencePreferencesProvider,
  parseStoredPreferences,
  STORAGE_KEY,
  useExperiencePreferences,
} from './ExperiencePreferences';

function Probe() {
  const preferences = useExperiencePreferences();
  return (
    <>
      <span>{preferences.effectiveReducedMotion ? 'reduced' : 'motion'}</span>
      <span>{preferences.quality}</span>
      <button onClick={() => preferences.setQuality('low')}>low</button>
    </>
  );
}
describe('ExperiencePreferences', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());
  it('detects system reduced motion and persists quality', async () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <ExperiencePreferencesProvider>
        <Probe />
      </ExperiencePreferencesProvider>,
    );
    expect(await screen.findByText('reduced')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'low' }));
    await act(async () => {});
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').quality).toBe('low');
  });
  it.each([
    ['invalid enum', { sound: true, motion: 'fast', quality: 'ultra' }],
    ['wrong types', { sound: 'yes', motion: 'auto', quality: 'low' }],
    ['incomplete record', { sound: false, motion: 'reduced' }],
  ])('falls back to defaults for an %s', async (_label, stored) => {
    expect(parseStoredPreferences(JSON.stringify(stored))).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    function FullProbe() {
      const value = useExperiencePreferences();
      return (
        <span>
          {JSON.stringify({ sound: value.sound, motion: value.motion, quality: value.quality })}
        </span>
      );
    }
    render(
      <ExperiencePreferencesProvider>
        <FullProbe />
      </ExperiencePreferencesProvider>,
    );
    expect(
      await screen.findByText(JSON.stringify({ sound: false, motion: 'auto', quality: 'auto' })),
    ).toBeInTheDocument();
  });
});

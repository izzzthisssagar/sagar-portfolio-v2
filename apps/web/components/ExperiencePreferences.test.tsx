import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ExperiencePreferencesProvider,
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
});

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperiencePreferencesProvider } from './ExperiencePreferences';
import { SystemCanvas } from './SystemCanvas';

describe('SystemCanvas fallback', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  it('provides a semantic static alternative when WebGL is unavailable', async () => {
    render(
      <ExperiencePreferencesProvider>
        <SystemCanvas />
      </ExperiencePreferencesProvider>,
    );
    const fallback = await screen.findByRole('img', { name: /layered interface/i });
    await waitFor(() => expect(fallback).toHaveTextContent('WebGL unavailable'));
  });
});

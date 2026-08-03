import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/components/SystemCanvas', () => ({
  SystemCanvas: () => <div role="img" aria-label="System Under Test" />,
}));
vi.mock('@/lib/public-content.server', () => ({
  getPublishedProjects: () => Promise.resolve([]),
  getPublishedProjectBySlug: () => Promise.resolve(null),
  getPublishedPosts: () => Promise.resolve([]),
  getActivePortrait: () => Promise.resolve(null),
  getCvAvailable: () => Promise.resolve(false),
  getPublicProfile: () => Promise.resolve(null),
}));
vi.mock('@/lib/seo', () => ({
  JsonLd: () => null,
  personJsonLd: () => ({}),
  websiteJsonLd: () => ({}),
}));
import Home from './page';
describe('homepage semantics', () => {
  it('keeps the primary evidence and navigation path in HTML', async () => {
    render(await Home());
    expect(
      screen.getByRole('heading', { level: 1, name: /turn assumptions/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'INSPECT MY WORK' })).toHaveAttribute('href', '/work');
    expect(screen.getByText('Model. Break. Trace. Verify.')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/components/SystemCanvas', () => ({
  SystemCanvas: () => <div role="img" aria-label="System Under Test" />,
}));
import Home from './page';
describe('homepage semantics', () => {
  it('keeps the primary evidence and navigation path in HTML', () => {
    render(<Home />);
    expect(
      screen.getByRole('heading', { level: 1, name: /turn assumptions/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'INSPECT MY WORK' })).toHaveAttribute('href', '/work');
    expect(screen.getByText('Model. Break. Trace. Verify.')).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './safe-redirect';

describe('safeReturnTo', () => {
  it('defaults when missing', () => {
    expect(safeReturnTo(undefined)).toBe('/admin/dashboard');
    expect(safeReturnTo(null)).toBe('/admin/dashboard');
    expect(safeReturnTo('')).toBe('/admin/dashboard');
  });
  it('allows an internal admin path', () => {
    expect(safeReturnTo('/admin/projects')).toBe('/admin/projects');
  });
  it('rejects protocol-relative URLs', () => {
    expect(safeReturnTo('//evil.example')).toBe('/admin/dashboard');
  });
  it('rejects absolute URLs', () => {
    expect(safeReturnTo('https://evil.example/admin/dashboard')).toBe('/admin/dashboard');
  });
  it('rejects paths outside /admin', () => {
    expect(safeReturnTo('/work')).toBe('/admin/dashboard');
  });
  it('rejects a loop back to the login page', () => {
    expect(safeReturnTo('/admin/login?returnTo=/admin/dashboard')).toBe('/admin/dashboard');
  });
});

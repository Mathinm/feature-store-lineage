import { describe, expect, it } from 'vitest';
import { matchPath, parseHash } from './router.js';

describe('hash router', () => {
  it('parses the path and query from the hash', () => {
    const loc = parseHash('#/assets/abc/history?from=2026-01-01');
    expect(loc.path).toBe('/assets/abc/history');
    expect(loc.segments).toEqual(['assets', 'abc', 'history']);
    expect(loc.query.get('from')).toBe('2026-01-01');
  });

  it('treats an empty hash, "#" and "#/" as the home screen', () => {
    expect(parseHash('').path).toBe('/');
    expect(parseHash('#').path).toBe('/');
    expect(parseHash('#/').path).toBe('/');
    expect(parseHash('#//assets/').path).toBe('/assets');
  });

  it('decodes query values such as a reset token', () => {
    expect(parseHash('#/reset-password?token=abc%2B1').query.get('token')).toBe('abc+1');
  });

  it('matches patterns and extracts params', () => {
    expect(matchPath('/', [])).toEqual({});
    expect(matchPath('/assets/:id/history', ['assets', 'a%20b', 'history'])).toEqual({ id: 'a b' });
    expect(matchPath('/assets/:id/history', ['assets', 'x', 'valuation'])).toBeNull();
    expect(matchPath('/assets', ['assets', 'x'])).toBeNull();
    expect(matchPath('/assets/:id', ['assets', '%E0%A4'])).toBeNull();
  });
});

// Minimal hash router: #/, #/login, #/assets/<id>/history, #/reset-password?token=...
// Hash URLs work on any static host without server rewrites, and anything in the
// hash (such as a password-reset token) is never sent to the server or leaked
// in the Referer header.
import { useEffect, useState } from 'react';

/** Split a location hash into a normalised path, its segments and the query after '?'. */
export function parseHash(hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const segments = (q === -1 ? raw : raw.slice(0, q)).split('/').filter(Boolean);
  return {
    path: `/${segments.join('/')}`,
    segments,
    query: new URLSearchParams(q === -1 ? '' : raw.slice(q + 1)),
  };
}

/** Match path segments against a pattern like '/assets/:id/history'; returns params or null. */
export function matchPath(pattern, segments) {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      try {
        params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
      } catch {
        return null;
      }
    } else if (parts[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}

/** The current hash location, updated on every hashchange. */
export function useHashLocation() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parseHash(hash);
}

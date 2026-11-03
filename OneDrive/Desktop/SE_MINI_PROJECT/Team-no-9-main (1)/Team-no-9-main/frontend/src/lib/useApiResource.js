// Loads data from the API and keeps it current. Shared by the dashboard cards and
// the asset screens.
// - Loads again when `key` changes (for example the trend range), when assets
//   change (onAssetsChanged, in this tab or another) and when the tab becomes
//   visible again, since the scheduler may have revalued things meanwhile.
// - A failed background reload keeps the data already on screen. A 401 is the
//   exception: the data is dropped so nothing from the old session stays visible.
// - Replies that arrive after a newer request was started are ignored.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isUnauthorized } from '../api/http.js';
import { onAssetsChanged } from '../api/assetEvents.js';

const LOADING = { status: 'loading', data: null, error: null, key: undefined };

export function useApiResource(fetcher, key, { live = true } = {}) {
  const [state, setState] = useState(LOADING);
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    return fetcher(key).then(
      (data) => {
        if (request === latest.current) setState({ status: 'ready', data, error: null, key });
      },
      (error) => {
        if (request !== latest.current) return;
        if (isUnauthorized(error)) {
          setState({ status: 'unauthorized', data: null, error, key });
        } else {
          // Keep what is shown only if it answers the same question (same key).
          setState((prev) =>
            prev.data && prev.key === key ? prev : { status: 'error', data: null, error, key },
          );
        }
      },
    );
  }, [fetcher, key]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return undefined;
    const onVisible = () => document.visibilityState === 'visible' && load();
    const unsubscribe = onAssetsChanged(load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, live]);

  const retry = useCallback(() => {
    setState(LOADING);
    load();
  }, [load]);

  return { ...state, retry };
}

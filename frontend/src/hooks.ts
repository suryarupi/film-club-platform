import { useEffect, useState } from 'react';

/** Runs an async loader when deps change. Gives back data, loading, a friendly error and a reload function. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: '' }));
    fn()
      .then((data) => live && set({ data, error: '', loading: false }))
      .catch((e: Error) => live && set({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

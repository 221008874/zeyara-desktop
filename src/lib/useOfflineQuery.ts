import React from 'react';
import { offlineGet, offlineWrite } from '../lib/offlineDb';

interface OfflineQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  isStale: boolean;
  refetch: () => Promise<void>;
}

/**
 * React hook that wraps offlineGet with loading/error state management.
 * Pages call: const { data, loading } = useOfflineQuery('/api/patients');
 */
export function useOfflineQuery<T = any>(
  path: string,
  opts?: { enabled?: boolean; refetchInterval?: number }
): OfflineQueryResult<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isOffline, setIsOffline] = React.useState(!navigator.onLine);
  const [isStale, setIsStale] = React.useState(false);

  const enabled = opts?.enabled !== false;

  const fetchData = React.useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await offlineGet<T>(path);
      setData(result);
      setIsStale(!navigator.onLine);
    } catch (err: any) {
      setError(err.message || 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }, [path, enabled]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Periodic refetch when online
  React.useEffect(() => {
    if (!opts?.refetchInterval || !enabled) return;
    const interval = setInterval(fetchData, opts.refetchInterval);
    return () => clearInterval(interval);
  }, [fetchData, opts?.refetchInterval, enabled]);

  // Listen for online/offline transitions
  React.useEffect(() => {
    const onOnline = () => { setIsOffline(false); fetchData(); };
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [fetchData]);

  return { data, loading, error, isOffline, isStale, refetch: fetchData };
}

/**
 * React hook for offline-aware mutations (POST/PUT/DELETE).
 * Returns a `mutate` function that queues writes when offline.
 */
export function useOfflineMutation<T = any>() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mutate = React.useCallback(
    async (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any) => {
      setLoading(true);
      setError(null);
      try {
        const result = await offlineWrite<T>(method, path, body);
        return result;
      } catch (err: any) {
        setError(err.message || 'فشلت العملية');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { mutate, loading, error };
}

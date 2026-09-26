/**
 * Offline-first data layer backed by localStorage.
 *
 * Architecture (mirrors the JavaFX AutoSyncService):
 * - GET requests: serve from local cache; when online, refresh from server in background.
 * - POST/PUT/DELETE: write to server immediately if online; when offline, queue for replay.
 * - Sync: when coming online, flush the write queue then pull fresh data.
 * - Conflict: last-write-wins (server is authoritative).
 */

import { api, getBaseUrl, getStoredSession } from './api';

const CACHE_PREFIX = 'zeyara_cache_';
const QUEUE_PREFIX = 'zeyara_write_queue:';
const STATUS_PREFIX = 'zeyara_offline_status:';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: any;
  timestamp: number; // Date.now() when cached
}

export interface QueuedWrite {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: any;
  queuedAt: number;
}

interface OfflineStatus {
  isOffline: boolean;
  lastOnlineAt: number | null;
  pendingWrites: number;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

function storageScope(): string {
  const session = getStoredSession() as { username?: string; role?: string } | null;
  return encodeURIComponent(`${getBaseUrl()}:${session?.username ?? 'anonymous'}:${session?.role ?? 'none'}`);
}

function cachePrefix(): string {
  return `${CACHE_PREFIX}${storageScope()}:`;
}

function queueKey(): string {
  return `${QUEUE_PREFIX}${storageScope()}`;
}

function statusKey(): string {
  return `${STATUS_PREFIX}${storageScope()}`;
}

function cacheKey(path: string): string {
  return cachePrefix() + path;
}

function getFromCache<T = any>(path: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    return entry.data as T;
  } catch {
    return null;
  }
}

function setCache(path: string, data: any): void {
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(cacheKey(path), JSON.stringify(entry));
  } catch {
    // localStorage full — evict oldest entries
    evictOldCache();
    try {
      localStorage.setItem(cacheKey(path), JSON.stringify({ data, timestamp: Date.now() }));
    } catch { /* give up */ }
  }
}

function evictOldCache(): void {
  const entries: { key: string; ts: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(cachePrefix())) {
      try {
        const e = JSON.parse(localStorage.getItem(k) || '{}');
        entries.push({ key: k, ts: e.timestamp ?? 0 });
      } catch { /* skip */ }
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  // Remove oldest 25%
  const remove = Math.max(1, Math.floor(entries.length * 0.25));
  for (let i = 0; i < remove; i++) {
    localStorage.removeItem(entries[i].key);
  }
}

// ─── Write Queue ────────────────────────────────────────────────────────────

export function getQueue(): QueuedWrite[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey()) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedWrite[]): void {
  localStorage.setItem(queueKey(), JSON.stringify(queue));
  updateStatus(queue.length);
}

let _queueId = 0;
function queueWrite(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any): QueuedWrite {
  const write: QueuedWrite = {
    id: `qw_${Date.now()}_${++_queueId}`,
    method,
    path,
    body,
    queuedAt: Date.now(),
  };
  const queue = getQueue();
  queue.push(write);
  saveQueue(queue);
  return write;
}

// ─── Status ─────────────────────────────────────────────────────────────────

function updateStatus(pendingWrites: number): void {
  const status: OfflineStatus = {
    isOffline: !navigator.onLine,
    lastOnlineAt: navigator.onLine ? Date.now() : getLastOnlineAt(),
    pendingWrites,
  };
  localStorage.setItem(statusKey(), JSON.stringify(status));
  window.dispatchEvent(new CustomEvent('offline-status', { detail: status }));
}

function getLastOnlineAt(): number | null {
  try {
    return JSON.parse(localStorage.getItem(statusKey()) || '{}').lastOnlineAt ?? null;
  } catch {
    return null;
  }
}

export function getOfflineStatus(): OfflineStatus {
  try {
    return JSON.parse(localStorage.getItem(statusKey()) || '{}');
  } catch {
    return { isOffline: !navigator.onLine, lastOnlineAt: null, pendingWrites: 0 };
  }
}

// ─── Offline-Aware API ──────────────────────────────────────────────────────

/**
 * Offline-aware GET: serve from cache, refresh from server in background.
 * Returns cached data immediately; if server is reachable, updates cache silently.
 */
export async function offlineGet<T = any>(path: string): Promise<T> {
  const cached = getFromCache<T>(path);

  if (!navigator.onLine || getBaseUrl() === '') {
    // Offline: return cache or throw
    if (cached !== null) return cached;
    throw new Error('offline');
  }

  // Online: try server first; fall back to cache on failure
  try {
    const res = await api.get<T>(path);
    setCache(path, res.data);
    updateStatus(getQueue().length);
    return res.data;
  } catch (err: any) {
    // Only fall back to cache when the server never answered. If it DID answer
    // with an error status, that error is the truth and must be surfaced:
    //  - 401/403 -> the caller is not allowed; serving cached data would show
    //    another role's records (e.g. a secretary opening Money Safe).
    //  - 400/404/409/422 -> the request itself is wrong; stale rows would hide it.
    //  - 503 -> the server is locked/starting; showing a stale balance as if it
    //    were current is the worst case for financial screens.
    // 408/429 are transient, so cache is an acceptable fallback for those.
    const status = err?.status;
    const serverAnswered = typeof status === 'number' && status > 0;
    const transient = status === 408 || status === 429;
    if (serverAnswered && !transient) throw err;
    if (cached !== null) return cached;
    throw new Error('فشل الاتصال بالسيرفر');
  }
}

/**
 * Offline-aware write: try server; if offline, queue for later replay.
 */
export interface OfflineWriteResult<T = any> {
  data: T;
  queued: boolean;
  reason?: 'offline' | 'server-error';
}

export async function offlineWrite<T = any>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: any
): Promise<OfflineWriteResult<T>> {
  if (!navigator.onLine || getBaseUrl() === '') {
    // Offline: queue for sync
    queueWrite(method, path, body);
    // Optimistically update local cache for GET-path reads
    invalidateCacheForPath(path);
    return { data: undefined as T, queued: true, reason: 'offline' };
  }

  try {
    let res;
    if (method === 'POST') res = await api.post<T>(path, body);
    else if (method === 'PUT') res = await api.put<T>(path, body);
    else res = await api.delete<T>(path);

    // Invalidate related caches so next GET fetches fresh data
    invalidateCacheForPath(path);
    updateStatus(getQueue().length);
    return { data: res.data, queued: false };
  } catch (err: any) {
    if (err?.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      throw err;
    }
    queueWrite(method, path, body);
    return { data: undefined as T, queued: true, reason: 'server-error' };
  }
}

function invalidateCacheForPath(path: string): void {
  // Remove the exact entry and any parent-list entries that might contain this resource
  localStorage.removeItem(cacheKey(path));

  // Invalidate list caches that this write might affect
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2) {
    // e.g. /api/patients/5 → invalidate /api/patients
    const listPath = '/' + parts.slice(0, -1).join('/');
    localStorage.removeItem(cacheKey(listPath));
  }

  // Aggregate/dashboard caches are derived from multiple resources — always
  // refresh them after any write so KPIs don't go stale.
  localStorage.removeItem(cacheKey('/api/dashboard/summary'));
  localStorage.removeItem(cacheKey('/api/health/stats'));
  localStorage.removeItem(cacheKey('/api/money-safe/balance'));
  localStorage.removeItem(cacheKey('/api/money-safe/transactions'));
}

// ─── Sync Service ───────────────────────────────────────────────────────────

let _syncInterval: ReturnType<typeof setInterval> | null = null;
let _isSyncing = false;

/**
 * Flush all queued writes to the server. Called automatically when coming online.
 * Returns the number of successfully flushed writes.
 */
export async function flushWriteQueue(): Promise<number> {
  if (_isSyncing) return 0;
  _isSyncing = true;

  const queue = getQueue();
  if (queue.length === 0) {
    _isSyncing = false;
    return 0;
  }

  let flushed = 0;
  const remaining: QueuedWrite[] = [];

  for (const write of queue) {
    try {
      if (write.method === 'POST') await api.post(write.path, write.body);
      else if (write.method === 'PUT') await api.put(write.path, write.body);
      else await api.delete(write.path);
      flushed++;
      invalidateCacheForPath(write.path);
    } catch (err: any) {
      const permanentClientError = err?.status >= 400 && err.status < 500
        && err.status !== 408 && err.status !== 429;
      if (!permanentClientError) remaining.push(write);
    }
  }

  saveQueue(remaining);
  _isSyncing = false;
  return flushed;
}

/**
 * Pull fresh data from server for all cached endpoints.
 * Returns the number of endpoints successfully refreshed.
 */
export async function pullFreshData(): Promise<number> {
  const paths: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(cachePrefix())) {
      paths.push(k.slice(cachePrefix().length));
    }
  }
  // Refresh in parallel (best-effort)
  const results = await Promise.allSettled(
    paths.map(async (path) => {
      try {
        const res = await api.get(path);
        setCache(path, res.data);
      } catch { /* keep stale cache */ }
    })
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}

/**
 * Full sync cycle: flush writes then pull fresh data.
 */
export async function syncNow(): Promise<{ flushed: number; pulled: number }> {
  const flushed = await flushWriteQueue();
  const pulled = await pullFreshData();
  return { flushed, pulled };
}

/**
 * Start periodic sync (every 30s when online).
 */
export function startSyncService(): void {
  if (_syncInterval) return;
  _syncInterval = setInterval(async () => {
    if (!navigator.onLine) return;
    // Flush queued writes AND pull fresh data so cached lists stay in sync
    // while the app is open (not just when coming online).
    await syncNow();
  }, 30_000);

  // Sync immediately on coming online
  window.addEventListener('online', async () => {
    updateStatus(getQueue().length);
    await syncNow();
  });
  window.addEventListener('offline', () => {
    updateStatus(getQueue().length);
  });

  updateStatus(getQueue().length);
}

/**
 * Stop periodic sync.
 */
export function stopSyncService(): void {
  if (_syncInterval) {
    clearInterval(_syncInterval);
    _syncInterval = null;
  }
}

/**
 * Seed the cache with data for common endpoints. Call on login when online.
 */
export async function seedCache(): Promise<void> {
  if (!navigator.onLine || getBaseUrl() === '') return;
  const paths = [
    '/api/patients',
    '/api/appointments',
    '/api/expenses',
    '/api/medications',
    '/api/notifications?seen=false',
    '/api/money-safe/balance',
    '/api/money-safe/transactions',
    '/api/dashboard/summary',
    '/api/schedule',
  ];
  await Promise.allSettled(
    paths.map(async (path) => {
      try {
        const res = await api.get(path);
        setCache(path, res.data);
      } catch { /* best-effort */ }
    })
  );
}

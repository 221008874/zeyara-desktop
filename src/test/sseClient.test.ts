import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SSEClient } from '../lib/sse';

/**
 * The live-notification stream.
 *
 * SSE is the one client component with a permanent background loop, so its failure
 * behaviour matters more than a page's: a stream that dies quietly leaves a clinic looking
 * at stale appointment and payment data with no indication anything is wrong. Three things
 * are therefore asserted here - that events actually reach subscribers, that a dropped or
 * rejected stream is retried rather than abandoned, and that `disconnect()` really stops
 * everything, because a retry loop that outlives its component is a leak that grows with
 * every navigation.
 */

const refreshAuthToken = vi.hoisted(() => vi.fn());
const getFingerprint = vi.hoisted(() => vi.fn(async () => 'fp-1'));
vi.mock('../lib/api', () => ({ refreshAuthToken, getFingerprint }));

/** A response whose body yields the given text chunks, then ends. */
function streamResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

beforeEach(() => {
  refreshAuthToken.mockReset();
  refreshAuthToken.mockResolvedValue(true);
  getFingerprint.mockClear();
  localStorage.setItem('zeyara_session', JSON.stringify({ state: { session: { token: 'tok-1' } } }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Lets the client's connect loop run for a bounded number of timer windows, then stops it.
 *
 * `connect()` only settles once `disconnect()` has been observed, so it must never be
 * awaited before the client is stopped - awaiting it first deadlocks, which is exactly what
 * the first draft of this file did.
 */
async function run(client: SSEClient, steps = 2) {
  const connecting = client.connect().catch(() => {});
  for (let i = 0; i < steps; i++) {
    await vi.advanceTimersByTimeAsync(2_000);
  }
  client.disconnect();
  // The loop is usually parked inside its backoff `setTimeout` when disconnect lands, so
  // the flag is only observed once that timer expires. Timers are frozen, so it has to be
  // advanced explicitly or the await below never settles.
  await vi.advanceTimersByTimeAsync(60_000);
  await connecting;
}

describe('event dispatch', () => {
  it('delivers a named event to its subscriber', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(['event: ping\ndata: {"n":1}\n\n'])));
    const client = new SSEClient('/api/events/stream', 'tok-1');
    const seen: unknown[] = [];
    client.on('ping', (e) => seen.push(e.data));

    await run(client, 1);

    expect(seen).toEqual(['{"n":1}']);
    client.disconnect();
  });

  it('delivers to every subscriber of an event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(['event: ping\ndata: x\n\n'])));
    const client = new SSEClient('/api/events/stream', 'tok-1');
    const a: string[] = [];
    const b: string[] = [];
    client.on('ping', (e) => a.push(e.data));
    client.on('ping', (e) => b.push(e.data));

    await run(client, 1);

    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
    client.disconnect();
  });

  it('stops delivering after off() removes the handler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(['event: ping\ndata: x\n\n'])));
    const client = new SSEClient('/api/events/stream', 'tok-1');
    const seen: string[] = [];
    const handler = (e: { data: string }) => seen.push(e.data);
    client.on('ping', handler);
    client.off('ping', handler);

    await run(client, 1);

    expect(seen).toEqual([]);
    client.disconnect();
  });

  it('tolerates off() for a handler that was never registered', () => {
    const client = new SSEClient('/api/events/stream', 'tok-1');
    expect(() => client.off('ping', () => {})).not.toThrow();
  });

  it('sends the bearer token and the event-stream accept header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    await run(client, 1);

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers.Accept).toBe('text/event-stream');
    client.disconnect();
  });
});

describe('resilience', () => {
  it('retries after the server closes the stream cleanly', async () => {
    // A clean EOF from a proxy teardown must not be mistaken for a healthy end of
    // subscription; otherwise the dashboard silently stops updating.
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    await run(client, 3);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    client.disconnect();
  });

  it('retries after an HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([], 500));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    await run(client, 3);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    client.disconnect();
  });

  it('refreshes the token when the server rejects auth, then retries', async () => {
    // Without this, an access token that expires mid-connection produces an endless 401
    // loop and the clinic never sees another notification.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(streamResponse([], 401))
      .mockResolvedValue(streamResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    await run(client, 3);

    expect(refreshAuthToken).toHaveBeenCalled();
    client.disconnect();
  });

  it('does not refresh the token for a non-auth failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([], 503));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    await run(client, 2);

    expect(refreshAuthToken).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('backs off rather than hammering an unavailable server', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    const connecting = client.connect().catch(() => {});
    // The first attempt is immediate; the retry waits out the initial 1s backoff.
    await vi.advanceTimersByTimeAsync(200);
    const immediate = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    const afterBackoff = fetchMock.mock.calls.length;

    // Attempts must grow with elapsed time, not track it one-for-one.
    expect(immediate).toBeLessThanOrEqual(1);
    expect(afterBackoff).toBeGreaterThan(immediate);
    expect(afterBackoff).toBeLessThan(10);

    client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    await connecting;
  });
});

describe('disconnect', () => {
  it('stops the retry loop', async () => {
    // A retry loop that outlives the component leaks a fetch loop per navigation, and
    // keeps a stale token in memory after sign-out.
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/api/events/stream', 'tok-1');

    const connecting = client.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(2_000);
    client.disconnect();
    const atDisconnect = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock.mock.calls.length).toBe(atDisconnect);
    await vi.advanceTimersByTimeAsync(60_000);
    await connecting;
  });

  it('is safe to call more than once', async () => {
    const client = new SSEClient('/api/events/stream', 'tok-1');
    expect(() => {
      client.disconnect();
      client.disconnect();
    }).not.toThrow();
  });

  it('prevents a connect() that is still starting from taking hold afterwards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([])));
    const client = new SSEClient('/api/events/stream', 'tok-1');
    const connecting = client.connect().catch(() => {});
    client.disconnect();
    await vi.advanceTimersByTimeAsync(5_000);
    await connecting;
    // Reaching here without a hung promise is the assertion: the loop observed the flag.
    expect(true).toBe(true);
  });
});

import React from 'react';
import { notificationBus } from '../lib/notificationBus';

let sseDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Subscribe to SSE events and trigger a refresh callback when relevant events
 * arrive. Mirrors the JavaFX behavior where SSE events trigger an immediate
 * data pull for the currently-open view.
 *
 * @param refresh - async callback that re-fetches data (e.g. the page's `load` function)
 * @param eventFilter - optional: only refresh when the SSE event type matches
 *                      one of these strings. If omitted, refresh on ALL events.
 */
export function useSseRefresh(
  refresh: () => Promise<void>,
  eventFilter?: string[]
) {
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;

  React.useEffect(() => {
    const unsub = notificationBus.subscribe((evt) => {
      if (eventFilter && !eventFilter.includes(evt.event)) return;
      // Debounce: multiple events may arrive in quick succession
      clearTimeout(sseDebounceTimer ?? undefined);
      sseDebounceTimer = setTimeout(() => {
        refreshRef.current();
      }, 300);
    });
    return unsub;
  }, [eventFilter]);
}

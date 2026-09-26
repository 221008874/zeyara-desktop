import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement matchMedia, which MUI's useMediaQuery calls on mount.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// The app is not running under Tauri in unit tests, so isTauriApp is false and the
// version falls back to the value vite injects. Nothing should reach for window.__TAURI__.
delete (window as unknown as Record<string, unknown>).__TAURI__;
delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

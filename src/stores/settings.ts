import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'light' | 'dark';
type Direction = 'ltr' | 'rtl';

interface SettingsState {
  language: 'en' | 'ar';
  theme: ThemeMode;
  direction: Direction;
  serverHost: string;
  serverPort: string;
  setLanguage: (lang: 'en' | 'ar') => void;
  setTheme: (theme: ThemeMode) => void;
  setServerConfig: (host: string, port: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'ar',
      theme: 'light',
      direction: 'rtl',
      // Intentionally blank. The Clinic Server runs on its own machine, so there is no
      // sensible default host: a pre-filled "localhost" reads as "already configured"
      // and hides an unconfigured client until a request fails with a confusing error.
      // The port default is kept because 8081 is the server's documented port.
      serverHost: '',
      serverPort: '8081',

      setLanguage: (lang) =>
        set({ language: lang, direction: lang === 'ar' ? 'rtl' : 'ltr' }),

      setTheme: (theme) => set({ theme }),

      setServerConfig: (host, port) =>
        set({ serverHost: host, serverPort: port }),
    }),
    {
      name: 'zeyara_settings',
    }
  )
);

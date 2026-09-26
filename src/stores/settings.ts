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
      serverHost: 'localhost',
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

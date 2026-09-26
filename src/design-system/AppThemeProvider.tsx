import React, { useMemo } from 'react';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useSettingsStore } from '../stores/settings';
import { createRtlCache, createLtrCache } from './theme/rtl';
import { buildTheme } from './theme';

interface AppThemeProviderProps {
  children: React.ReactNode;
}

export const AppThemeProvider: React.FC<AppThemeProviderProps> = ({ children }) => {
  const { theme, direction } = useSettingsStore();
  const rtlCache = useMemo(() => createRtlCache(), []);
  const ltrCache = useMemo(() => createLtrCache(), []);
  const cache = direction === 'rtl' ? rtlCache : ltrCache;
  const muiTheme = useMemo(() => buildTheme(theme, direction), [theme, direction]);

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
};


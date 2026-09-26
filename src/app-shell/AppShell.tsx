import React from 'react';
import { Box } from '@mui/material';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { OfflineBanner } from './OfflineBanner';
import { useAuthStore } from '../stores/auth';
import { notificationBus } from '../lib/notificationBus';
import { initCloseBackup } from '../lib/closeBackup';
import { startSyncService, stopSyncService, seedCache } from '../lib/offlineDb';

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const { session } = useAuthStore();

  React.useEffect(() => {
    if (session?.token) {
      notificationBus.connect();
      initCloseBackup();
      startSyncService();
      seedCache();
    } else {
      notificationBus.disconnect();
      stopSyncService();
    }
    return () => stopSyncService();
  }, [session?.token]);

  return (
    <Box sx={{ display: 'flex', height: '100vh', direction: 'rtl' }}>
      <Sidebar />
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <TopBar />
        <Box component="main" sx={{ flex: 1, overflow: 'auto', p: 3, bgcolor: 'background.default' }}>
          <OfflineBanner />
          {children}
        </Box>
      </Box>
    </Box>
  );
};

import React from 'react';
import { Alert, AlertTitle, Button, Chip, Typography, Box } from '@mui/material';
import { getOfflineStatus, getQueue, syncNow } from '../lib/offlineDb';

export const OfflineBanner: React.FC = () => {
  const [status, setStatus] = React.useState(() => getOfflineStatus());
  const [syncing, setSyncing] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setStatus(detail);
    };
    window.addEventListener('offline-status', handler);
    return () => window.removeEventListener('offline-status', handler);
  }, []);

  const pendingCount = getQueue().length;

  if (!status.isOffline && pendingCount === 0) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  if (status.isOffline) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>وضع عدم الاتصال</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1 }}>
          لا يمكن الاتصال بالخادم. البيانات المعروضة من آخر مزامنة.
          {pendingCount > 0 && (
            <Chip
              label={`${pendingCount} عملية في انتظار المزامنة`}
              size="small"
              color="warning"
              sx={{ ml: 1 }}
            />
          )}
        </Typography>
      </Alert>
    );
  }

  // Online but has pending writes
  return (
    <Alert severity="info" sx={{ mb: 2 }} icon={null}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2">
          {pendingCount > 0
            ? `يوجد ${pendingCount} عملية في انتظار المزامنة مع الخادم`
            : 'تم الاتصال بالخادم'}
        </Typography>
        {pendingCount > 0 && (
          <Button size="small" variant="outlined" onClick={handleSync} disabled={syncing}>
            {syncing ? 'جاري المزامنة...' : 'مزامنة الآن'}
          </Button>
        )}
      </Box>
    </Alert>
  );
};

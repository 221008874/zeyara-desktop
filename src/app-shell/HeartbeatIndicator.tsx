import React from 'react';
import {
  Box, Typography, Tooltip, Button, Chip, Stack,
} from '@mui/material';
import { useHeartbeat, acceptCandidate } from '../lib/heartbeat';
import { isHeartbeatSupported } from '../lib/heartbeat';
import { useAuthStore, type Role } from '../stores/auth';

/**
 * Connection status for the Clinic Server on the LAN.
 *
 * A discovered server is never adopted silently. When discovery hears something it has
 * not been told to trust, this shows the candidates and asks; only an ADMIN may answer,
 * because approving a server redirects every subsequent request in the app.
 */
const HeartbeatIndicator: React.FC = () => {
  const hb = useHeartbeat();
  const session = useAuthStore((s) => s.session);
  const isAdmin: boolean = session?.role === ('ADMIN' satisfies Role);
  const [busy, setBusy] = React.useState(false);

  if (!isHeartbeatSupported()) return null;

  const online = hb.status === 'online';
  const awaiting = hb.status === 'awaiting-choice' && hb.candidates.length > 0;
  const offline = hb.status === 'offline' || hb.status === 'error';

  const dotColor = online ? '#22C55E' : offline ? '#EF4444' : awaiting ? '#F59E0B' : '#9CA3AF';

  const title = online && hb.server
    ? `متصل بـ: ${hb.server.name} (${hb.server.ip}:${hb.server.port})` +
      (hb.server.verified ? ' — تم التحقق' : ' — تم اعتماده يدوياً')
    : hb.status === 'offline'
      ? 'لا يوجد خادم متاح'
      : hb.status === 'error'
        ? `خطأ في الاكتشاف: ${hb.error}`
        : awaiting
          ? 'وجد خادم جديد — بانتظار الاعتماد'
          : 'جارٍ البحث عن خادم على الشبكة…';

  const handleAccept = async (c: typeof hb.candidates[number]) => {
    setBusy(true);
    try {
      await acceptCandidate(c);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {awaiting && (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={
            hb.unverifiedMode
              ? 'اكتشف خادماً غير موثّق'
              : `اكتشف خادماً آخر (${hb.candidates.length})`
          }
        />
      )}
      <Tooltip title={title} arrow>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: 999,
            bgcolor: 'rgba(0,0,0,0.04)',
            cursor: 'default',
          }}
        >
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: dotColor }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {online ? 'متصل' : offline ? 'غير متصل' : '...'}
          </Typography>
        </Box>
      </Tooltip>

      {awaiting && (
        <Box
          sx={{
            position: 'absolute',
            top: '100%',
            insetInlineStart: 0,
            mt: 1,
            minWidth: 320,
            p: 2,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            boxShadow: 3,
            zIndex: 1200,
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 700 }}>
            خوادم مكتشفة على الشبكة
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: 'text.secondary' }}>
            {hb.unverifiedMode
              ? 'لم يتم إعداد مفتاح التحقق، لذا لا يمكن التحقق من هوية هذه الخوادم. تأكد من العنوان قبل الاعتماد.'
              : 'يوجد أكثر من خادم على الشبكة. اختر الخادم الصحيح لعيادتك.'}
          </Typography>

          <Stack spacing={1}>
            {hb.candidates.map((c) => (
              <Stack
                key={`${c.ip}:${c.port}`}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
              >
                <Box>
                  <Typography variant="body2">{c.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.ip}:{c.port} {c.verified ? '— موثّق' : '— غير موثّق'}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!isAdmin || busy}
                  onClick={() => void handleAccept(c)}
                >
                  اعتماد
                </Button>
              </Stack>
            ))}
          </Stack>

          {!isAdmin && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'warning.main' }}>
              اعتماد خادم يتطلب صلاحية مدير النظام.
            </Typography>
          )}
        </Box>
      )}
    </Stack>
  );
};

export default HeartbeatIndicator;

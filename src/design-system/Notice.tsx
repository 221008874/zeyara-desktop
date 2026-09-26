import React from 'react';
import { Paper, Typography, alpha } from '@mui/material';

type NoticeTone = 'success' | 'error' | 'info' | 'warning';

interface NoticeProps {
  tone: NoticeTone;
  msg: string;
  sx?: React.ComponentProps<typeof Paper>['sx'];
}

const toneColor: Record<NoticeTone, string> = {
  success: '#16A34A',
  error: '#DC2626',
  info: '#18181B',
  warning: '#D97706',
};

/**
 * A theme-aware inline status notice. Uses the semantic color at low alpha so
 * it reads correctly in both light and dark mode.
 */
export const Notice: React.FC<NoticeProps> = ({ tone, msg, sx }) => {
  const main = toneColor[tone];
  return (
    <Paper
      sx={{
        p: 1.5,
        mb: 2,
        bgcolor: (theme) => alpha(main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
        border: (theme) => `1px solid ${alpha(main, theme.palette.mode === 'dark' ? 0.45 : 0.35)}`,
        ...sx,
      }}
    >
      <Typography
        variant="body2"
        sx={{ color: main, fontWeight: 600 }}
      >
        {msg}
      </Typography>
    </Paper>
  );
};

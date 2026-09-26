import React from 'react';
import { Box, Button, Typography } from '@mui/material';

interface EmptyStateProps {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Actionable empty state shown when a list has no data. Optionally renders a
 * call-to-action button so the user knows the next step instead of a bare
 * "no data" string.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ title, hint, actionLabel, onAction }) => (
  <Box sx={{ py: 6, textAlign: 'center' }}>
    <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary' }}>
      {title}
    </Typography>
    {hint && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: actionLabel ? 2 : 0 }}>
        {hint}
      </Typography>
    )}
    {actionLabel && onAction && (
      <Button variant="contained" onClick={onAction} sx={{ mt: 2 }}>
        {actionLabel}
      </Button>
    )}
  </Box>
);

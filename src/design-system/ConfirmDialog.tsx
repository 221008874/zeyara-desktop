import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: 'primary' | 'error' | 'warning';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog. Disables the confirm button while `busy`.
 * Escape/backdrop close is left enabled (cancelling is safe — no data loss).
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  confirmColor = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}) => (
  <Dialog open={open} onClose={() => !busy && onCancel()} maxWidth="xs" fullWidth>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{message}</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
      <Button onClick={onConfirm} color={confirmColor} variant="contained" disabled={busy}>
        {busy ? '…' : confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);

import { createTheme } from '@mui/material/styles';
import { typography } from './typography';
import { lightPalette } from './palette';
import { darkPalette } from './palette';
import { radiusTokens, spacingUnit } from './tokens';

const hairlineShadow =
  '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)';
const dialogShadow = '0 24px 64px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)';

export function buildTheme(mode: 'light' | 'dark', direction: 'ltr' | 'rtl') {
  const palette = mode === 'dark' ? darkPalette : lightPalette;
  return createTheme({
    direction,
    palette,
    typography,
    spacing: spacingUnit,
    shape: { borderRadius: radiusTokens.md },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: radiusTokens.sm,
            boxShadow: 'none',
            fontWeight: 600,
            letterSpacing: 0,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }: any) => ({
            borderRadius: radiusTokens.md,
            backgroundColor: theme.palette.background.paper,
            border: '1px solid',
            borderColor: theme.palette.divider,
            boxShadow: 'none',
          }),
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            boxShadow: hairlineShadow,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            boxShadow: hairlineShadow,
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            boxShadow: hairlineShadow,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: radiusTokens.md },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: radiusTokens.lg,
            border: 'none',
            boxShadow: dialogShadow,
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: ({ theme }: any) => ({
            backgroundColor: 'transparent',
            '& .MuiTableCell-root': {
              color: theme.palette.text.secondary,
              fontWeight: 600,
              fontSize: '0.75rem',
              whiteSpace: 'nowrap',
            },
          }),
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: ({ theme }: any) => ({
            '&:hover': {
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? 'rgba(255,255,255,0.05)'
                  : 'rgba(0,0,0,0.04)',
            },
            '&.Mui-selected': {
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? 'rgba(255,255,255,0.07)'
                  : 'rgba(0,0,0,0.05)',
            },
          }),
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }: any) => ({
            fontVariantNumeric: 'tabular-nums',
            borderColor: theme.palette.divider,
          }),
        },
      },
      MuiChip: {
        defaultProps: {
          variant: 'outlined',
          size: 'small',
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
          variant: 'outlined',
        },
      },
    },
  });
}
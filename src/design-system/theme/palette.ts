import { colors } from './tokens';

export const lightPalette = {
  mode: 'light' as const,
  primary: colors.primary,
  success: colors.success,
  warning: colors.warning,
  error: colors.danger,
  background: {
    default: colors.background.default,
    paper: colors.background.paper,
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
  },
  divider: colors.divider,
};

export const darkPalette = {
  mode: 'dark' as const,
  primary: {
    main: '#F4F4F5',
    light: '#FAFAFA',
    dark: '#D4D4D8',
    contrastText: '#18181B',
  },
  success: colors.success,
  warning: colors.warning,
  error: colors.danger,
  background: {
    default: '#0C0C0E',
    paper: '#151517',
  },
  text: {
    primary: '#F4F4F5',
    secondary: '#A1A1AA',
  },
  divider: '#27272A',
};

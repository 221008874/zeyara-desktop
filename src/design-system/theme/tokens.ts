export const spacingUnit = 8;

export const radiusTokens = {
  sm: 2,
  md: 6,
  lg: 10,
  pill: 999,
} as const;

export const fontTokens = {
  family: '"Cairo", "Segoe UI", Roboto, Arial, sans-serif',
  weights: {
    regular: 400,
    medium: 600,
    bold: 700,
  },
  sizes: {
    h1: '1.5rem',
    h2: '1.25rem',
    h3: '1.1rem',
    body1: '0.875rem',
    body2: '0.8rem',
    caption: '0.75rem',
  },
} as const;

// Minimal, grayscale-first palette — ink (near-black) acting as the primary
// "accent", neutral zinc surfaces, and restrained semantic colors reserved
// strictly for status (success / warning / danger).
export const colors = {
  primary: {
    main: '#18181B',
    light: '#3F3F46',
    dark: '#09090B',
    contrastText: '#FFFFFF',
  },
  success: {
    main: '#16A34A',
    light: '#4ADE80',
    dark: '#15803D',
  },
  warning: {
    main: '#D97706',
    light: '#FBBF24',
    dark: '#B45309',
  },
  danger: {
    main: '#DC2626',
    light: '#F87171',
    dark: '#B91C1C',
  },
  background: {
    default: '#FAFAF9',
    paper: '#FFFFFF',
  },
  text: {
    primary: '#18181B',
    secondary: '#71717A',
  },
  divider: '#E4E4E7',
} as const;

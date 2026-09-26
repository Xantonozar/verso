import { Platform } from 'react-native';

/**
 * "Ink & Parchment" placeholder tokens (build plan §13).
 * Values are a direction, not final: Phase 15 replaces them with the
 * Stitch-exported design system. Components must import from here —
 * never hardcode colors/spacing in screens.
 */
export const colors = {
  background: '#FAF7F2',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EDE4',
  ink: '#1C1B19',
  inkSecondary: '#5A5651',
  inkMuted: '#8A857E',
  border: '#E4DDD3',
  accent: '#B85C38',
  accentPressed: '#9A4A2B',
  accentSoft: '#F5E3DA',
  onAccent: '#FFFFFF',
  success: '#3E7C4F',
  error: '#B3261E',
  warning: '#B07C1E',
  skeleton: '#E9E2D8',
  overlay: 'rgba(28, 27, 25, 0.45)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 34,
} as const;

export const lineHeights = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 26,
  xl: 30,
  xxl: 36,
  display: 40,
} as const;

/** Serif for poem body (long-form reading), sans for UI chrome. */
export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }) as string,
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
} as const;

export const typography = {
  poemBody: {
    fontFamily: fonts.serif,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg + 6,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: fontSizes.xxl,
    lineHeight: lineHeights.xxl,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  caption: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
  },
} as const;

export const layout = {
  touchTargetMin: 44,
  maxContentWidth: 560,
} as const;

export const colors = {
  primary: '#DC2626',
  bg: '#FAFAF7',
  bgDark: '#0E0E10',
  surface: '#FFFFFF',
  surfaceDark: '#1A1A1D',
  text: '#0E0E10',
  textDark: '#F5F5F0',
  muted: '#737373',
  accent: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#FF5A5F',
  pitch: {
    atamadaka: '#FF5A5F',
    heiban: '#3B82F6',
    nakadaka: '#F59E0B',
    odaka: '#EC4899',
  },
} as const;

export type PitchPattern = 'atamadaka' | 'heiban' | 'nakadaka' | 'odaka';

export const pitchColor = (p: PitchPattern): string => colors.pitch[p];

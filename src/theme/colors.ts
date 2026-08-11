export const colors = {
  primary: "#DC2626",
  bg: "#FAFAF7",
  bgDark: "#0E0E10",
  surface: "#FFFFFF",
  surfaceDark: "#1A1A1D",
  text: "#0E0E10",
  textDark: "#F5F5F0",
  muted: "#737373",
  accent: "#3B82F6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#FF5A5F",
  pitch: {
    atamadaka: "#FF5A5F",
    heiban: "#3B82F6",
    nakadaka: "#F59E0B",
    odaka: "#EC4899",
  },
  conversation: {
    light: {
      canvas: "#EEF1ED",
      ink: "#172220",
      muted: "#68736E",
      seam: "#315F63",
      seamSoft: "#D3DFDA",
      proof: "#C84E38",
      brass: "#967C4D",
      success: "#687B55",
      control: "#172220",
      controlText: "#F4F3EC",
      hairline: "#CAD2CD",
    },
    dark: {
      canvas: "#0E1514",
      ink: "#EDF0EA",
      muted: "#95A09A",
      seam: "#82AAA6",
      seamSoft: "#203430",
      proof: "#E06A51",
      brass: "#B9A474",
      success: "#9DAE82",
      control: "#E8ECE5",
      controlText: "#101715",
      hairline: "#293733",
    },
  },
} as const;

export type PitchPattern = "atamadaka" | "heiban" | "nakadaka" | "odaka";

export const pitchColor = (p: PitchPattern): string => colors.pitch[p];

import type { ImageSourcePropType } from "react-native";

import manifest from "../../assets/illustrations/koe/manifest.json";

type AppearanceSources = {
  light: ImageSourcePropType;
  dark: ImageSourcePropType;
};

export const koeIllustrationManifest = manifest;

export const koeIllustrations = {
  microphoneEducation: {
    light: require("../../assets/illustrations/koe/microphone-education-light.webp"),
    dark: require("../../assets/illustrations/koe/microphone-education-dark.webp"),
  },
  homeStart: {
    light: require("../../assets/illustrations/koe/home-start-light.webp"),
    dark: require("../../assets/illustrations/koe/home-start-dark.webp"),
  },
  recovery: {
    light: require("../../assets/illustrations/koe/recovery-light.webp"),
    dark: require("../../assets/illustrations/koe/recovery-dark.webp"),
  },
  coda: {
    light: require("../../assets/illustrations/koe/coda-light.webp"),
    dark: require("../../assets/illustrations/koe/coda-dark.webp"),
  },
} satisfies Record<keyof typeof manifest.assets, AppearanceSources>;

export type KoeIllustrationName = keyof typeof koeIllustrations;

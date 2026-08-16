export type KoeVoice = "ja-female-1" | "ja-female-2" | "ja-male-1";
export type CorrectionStyle = "essential" | "balanced" | "detailed";

/**
 * The complete V1 surface and behavior contract. Product code consumes these
 * defaults directly so a fresh conversation cannot acquire setup choices.
 */
export const KOE_V1_PRODUCT_CONTRACT = {
  routeFiles: ["index.tsx", "onboarding/welcome.tsx", "session/[id].tsx"],
  stackScreens: ["index", "onboarding", "session/[id]"],
  setupChoices: [],
  lifecycle: [
    "open",
    "start",
    "converse-hands-free",
    "hear-koe",
    "receive-optional-compact-correction",
    "continue",
    "end",
  ],
  conversation: {
    voice: "ja-female-1",
    correctionStyle: "essential",
  },
} as const satisfies {
  routeFiles: readonly string[];
  stackScreens: readonly string[];
  setupChoices: readonly string[];
  lifecycle: readonly string[];
  conversation: {
    voice: KoeVoice;
    correctionStyle: CorrectionStyle;
  };
};

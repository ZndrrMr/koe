import { KOE_V1_VOICE_ID } from "../../shared/inworld";

/**
 * The complete V1 surface and behavior contract. Product code consumes these
 * fixed values directly so a fresh or previously configured installation
 * cannot acquire setup choices.
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
    provider: "inworld",
    voice: KOE_V1_VOICE_ID,
    feedback: "essential-only",
  },
} as const;

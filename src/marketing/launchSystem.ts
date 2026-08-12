import type { PronunciationFeedback } from "@/services/pitch";
import type { VoicePhase } from "@/voice/lifecycle";

export type MarketingFrameId = "speak" | "reply" | "tune" | "compare" | "keep";

export type MarketingFrame = {
  id: MarketingFrameId;
  order: number;
  eyebrow: string;
  headline: string;
  detail: string;
  phase: VoicePhase;
  durationMs: number;
  utteranceJa: string;
  utteranceEn: string;
};

/**
 * One conversation is held constant across screenshots, preview motion, and
 * the landing page. That makes alternate product-page stories a copy test,
 * rather than a fork of Koe's product or demo behavior.
 */
export const MARKETING_FRAMES: readonly MarketingFrame[] = [
  {
    id: "speak",
    order: 1,
    eyebrow: "SPEAK / 発話",
    headline: "Speak Japanese. Get an actual answer.",
    detail: "No lesson picker. Start with the thing you want to say.",
    phase: "listening",
    durationMs: 1_800,
    utteranceJa: "昨日、友達と映画を見ました。",
    utteranceEn: "Yesterday, I watched a movie with a friend.",
  },
  {
    id: "reply",
    order: 2,
    eyebrow: "HEAR / 応答",
    headline: "Hear the reply before the lesson.",
    detail: "Koe answers naturally, then keeps coaching out of the way.",
    phase: "speaking",
    durationMs: 2_300,
    utteranceJa: "いいですね。どんな映画でしたか？",
    utteranceEn: "Nice. What kind of movie was it?",
  },
  {
    id: "tune",
    order: 3,
    eyebrow: "TUNE / 一点",
    headline: "See the one sound to tune.",
    detail: "Pitch and timing become one useful next rep—not a report card.",
    phase: "feedback",
    durationMs: 3_000,
    utteranceJa: "映画 → え・い・が",
    utteranceEn: "Let えい take two beats.",
  },
  {
    id: "compare",
    order: 4,
    eyebrow: "RETRY / 比較",
    headline: "Retry. Compare what changed.",
    detail: "The long vowel held. The conversation is still waiting.",
    phase: "comparing",
    durationMs: 2_700,
    utteranceJa: "映画",
    utteranceEn: "This time, both beats landed.",
  },
  {
    id: "keep",
    order: 5,
    eyebrow: "KEEP / 余韻",
    headline: "Keep the Japanese worth remembering.",
    detail: "Save the expression and the correction—not a chat archive.",
    phase: "success",
    durationMs: 3_200,
    utteranceJa: "どんな映画でしたか？",
    utteranceEn: "What kind of movie was it?",
  },
] as const;

export const PRODUCT_PAGE_THESIS =
  "Speak Japanese. Hear exactly how to sound better.";

export const APP_STORE_COPY = {
  name: "Koe",
  subtitle: "Japanese speaking, tuned",
  promotionalText:
    "Speak naturally, hear a real Japanese reply, then fix the one pitch or timing detail that will help most.",
  description: [
    PRODUCT_PAGE_THESIS,
    "Koe is a voice-first Japanese conversation partner. Start talking without choosing a lesson or roleplay. Koe answers the meaning first, then offers one optional pronunciation note after the turn.",
    "See pitch and mora timing together. Retry only the useful phrase, compare what changed, and return to the conversation that was already underway.",
    "At the end, keep the expressions and corrections worth carrying forward. Your full conversation stays private unless you explicitly choose otherwise.",
  ],
  keywords:
    "japanese,speaking,pronunciation,pitch accent,conversation,shadowing,voice,mora",
} as const;

export const LAUNCH_COPY = {
  announcement: [
    "I’m building Koe because I want Japanese practice to feel like talking, not taking a test.",
    PRODUCT_PAGE_THESIS,
    "You say the thing you meant. Koe answers it. Then it shows one pitch or timing detail worth a retry—and gives the conversation back.",
  ],
  creatorSeriesOpener:
    "I’m building the Japanese voice interaction I want to study with. This is what changed in Koe this week, the phrase I tried, and what I still got wrong.",
  beforeAfterCaption:
    "My first try shortened えい in 映画. Koe asked for one more rep; the retry held both beats. Same conversation, one useful change.",
  nativeCritiqueInvite:
    "Native speakers: does this correction sound accurate, tactful, and worth interrupting the flow for? I’ll show what I change from the critique.",
  landingCta: "See the speaking loop",
} as const;

export const PRODUCT_PAGE_VARIANTS = [
  {
    id: "conversation-first",
    hypothesis:
      "A natural answer before correction makes Koe feel like conversation, not oral homework.",
    headline: PRODUCT_PAGE_THESIS,
    frameIds: ["speak", "reply", "tune", "compare", "keep"],
  },
  {
    id: "proof-first",
    hypothesis:
      "Learners already seeking pronunciation help may respond faster to visible before/after proof.",
    headline: "Hear the difference one useful sound makes.",
    frameIds: ["tune", "compare", "reply", "speak", "keep"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  hypothesis: string;
  headline: string;
  frameIds: readonly MarketingFrameId[];
}>;

export const CREATOR_LOOP = {
  principle:
    "Publish from work and study that already happened; never manufacture a learner persona for the feed.",
  loop: [
    "Build one visible part of the voice interaction",
    "Use it in Zander's own Japanese study",
    "Share the specific before/after or design decision",
    "Invite a native-speaker or learner critique",
    "Show what changed in the next build",
  ],
  publishingRhythm:
    "One primary story when a real build-and-study loop produces something worth sharing; cut smaller clips from that same evidence instead of feeding a separate content treadmill.",
  recurringFormats: [
    {
      id: "build-the-voice",
      source: "A voice interaction Zander is implementing now",
      artifact: "Muted state walkthrough or latency/design breakdown",
    },
    {
      id: "study-with-koe",
      source: "A phrase Zander genuinely wanted in his own Japanese",
      artifact: "One short study session and the useful correction",
    },
    {
      id: "before-after",
      source: "Zander's own first try and retry",
      artifact: "Audio before/after with the pitch-and-timing comparison",
    },
    {
      id: "native-critique",
      source: "An invited native speaker reviewing Koe or Zander",
      artifact: "The critique, what Koe got wrong, and the resulting change",
    },
    {
      id: "design-breakdown",
      source: "A product decision from the active Koe build",
      artifact: "The rejected alternatives and why the shipped behavior won",
    },
  ],
  consent: {
    defaultSource: "Zander's own recordings or the deterministic Koe demo",
    publicUserConversationRequires: "explicit, recorded, revocable consent",
    withoutConsent:
      "Do not publish audio, transcript, screen capture, identifying detail, or a reconstruction of the conversation.",
  },
} as const;

export const MARKETING_CAPTURE = {
  route: "marketing-capture",
  canvas: { width: 1206, height: 2622 },
  preview: {
    fps: 30,
    durationMs: MARKETING_FRAMES.reduce(
      (total, frame) => total + frame.durationMs,
      0,
    ),
    firstCorrectionAtMs: previewElapsedMs("tune"),
  },
  environment: {
    EXPO_PUBLIC_KOE_REVIEW_ROUTE: "marketing-capture",
    EXPO_PUBLIC_KOE_REVIEW_SCHEME: "light",
    EXPO_PUBLIC_KOE_MARKETING_CAPTURE: "1",
    EXPO_PUBLIC_KOE_MARKETING_SEQUENCE: "1",
  },
  generated: {
    screenshots: MARKETING_FRAMES.map(
      (frame) =>
        `marketing/generated/app-store-${String(frame.order).padStart(2, "0")}-${frame.id === "reply" ? "hear" : frame.id === "compare" ? "retry" : frame.id}.png`,
    ),
    preview: "marketing/generated/koe-app-preview.mp4",
    contactSheet: "marketing/generated/app-store-story-contact-sheet.png",
    landingProof: "marketing/generated/landing-ipad.png",
    icon: "assets/icon.png",
  },
} as const;

export const DEMO_PRONUNCIATION: PronunciationFeedback = {
  version: 1,
  status: "aligned",
  targetText: "映画",
  units: [
    {
      unit: "え",
      index: 0,
      referenceStartMs: 0,
      referenceEndMs: 230,
      attemptStartMs: 0,
      attemptEndMs: 178,
      referencePitchSemitones: -1.2,
      attemptPitchSemitones: -1.8,
      referenceVoicedRatio: 0.94,
      attemptVoicedRatio: 0.91,
      durationRatio: 0.77,
      pitchScore: 86,
      timingScore: 72,
      voicingScore: 92,
      score: 81,
    },
    {
      unit: "い",
      index: 1,
      referenceStartMs: 230,
      referenceEndMs: 470,
      attemptStartMs: 178,
      attemptEndMs: 300,
      referencePitchSemitones: 1.6,
      attemptPitchSemitones: 0.2,
      referenceVoicedRatio: 0.96,
      attemptVoicedRatio: 0.82,
      durationRatio: 0.51,
      pitchScore: 68,
      timingScore: 44,
      voicingScore: 79,
      score: 61,
    },
    {
      unit: "が",
      index: 2,
      referenceStartMs: 470,
      referenceEndMs: 750,
      attemptStartMs: 300,
      attemptEndMs: 565,
      referencePitchSemitones: -0.5,
      attemptPitchSemitones: -0.8,
      referenceVoicedRatio: 0.91,
      attemptVoicedRatio: 0.9,
      durationRatio: 0.95,
      pitchScore: 90,
      timingScore: 91,
      voicingScore: 91,
      score: 91,
    },
  ],
  reference: {
    f0: [185, 190, 198, 212, 222, 218, 207, 196, 188],
    timestamps: [0, 95, 190, 285, 380, 475, 570, 665, 750],
    rms: [0.15, 0.24, 0.31, 0.35, 0.34, 0.3, 0.27, 0.22, 0.14],
    voicedRatio: 0.94,
    durationMs: 750,
  },
  attempt: {
    f0: [181, 188, 197, 201, 198, 194, 187],
    timestamps: [0, 92, 184, 276, 368, 466, 565],
    rms: [0.14, 0.25, 0.32, 0.33, 0.3, 0.23, 0.13],
    voicedRatio: 0.88,
    durationMs: 565,
  },
  alignmentPath: [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 4],
    [6, 5],
    [7, 6],
    [8, 6],
  ],
  scores: { pitch: 81, timing: 69, voicing: 87, overall: 78 },
  firstCorrection: "In 映画, let えい take two beats.",
  target: { unit: "い", unitIndex: 1, dimension: "timing", score: 44 },
};

export function marketingFrame(id?: string): MarketingFrame {
  return (
    MARKETING_FRAMES.find((frame) => frame.id === id) ?? MARKETING_FRAMES[0]
  );
}

export function nextMarketingFrame(id: MarketingFrameId): MarketingFrame {
  const index = MARKETING_FRAMES.findIndex((frame) => frame.id === id);
  return MARKETING_FRAMES[(index + 1) % MARKETING_FRAMES.length];
}

export function previewElapsedMs(frameId: MarketingFrameId): number {
  const index = MARKETING_FRAMES.findIndex((frame) => frame.id === frameId);
  return MARKETING_FRAMES.slice(0, Math.max(0, index)).reduce(
    (total, frame) => total + frame.durationMs,
    0,
  );
}

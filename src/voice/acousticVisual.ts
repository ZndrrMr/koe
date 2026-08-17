import type { VoicePhase } from "@/voice/lifecycle";

export type AcousticPlateKind =
  | "ready"
  | "listening"
  | "understanding"
  | "speaking"
  | "note"
  | "recovery";

export type AcousticPresentation = {
  eyebrow: string;
  titleJa: string;
  titleEn: string;
  accessibilityLabel: string;
  plate: AcousticPlateKind;
};

/**
 * Voice state is deliberately discrete. The zero-update budget prevents audio
 * metering or background work from becoming a decorative animation again.
 */
export const ACOUSTIC_MOTION_POLICY = {
  mode: "static",
  continuousVisualUpdates: 0,
  transitionDurationMs: 0,
} as const;

export const ACOUSTIC_PRESENTATION: Record<VoicePhase, AcousticPresentation> = {
  idle: {
    eyebrow: "VOICE / 01",
    titleJa: "どうぞ",
    titleEn: "Ready when you are",
    accessibilityLabel: "Ready. Tap Start once, then speak naturally.",
    plate: "ready",
  },
  listening: {
    eyebrow: "LISTENING / 入力",
    titleJa: "聞いています",
    titleEn: "Listening",
    accessibilityLabel:
      "Listening. Speak naturally; the live transcript appears below.",
    plate: "listening",
  },
  interimTranscript: {
    eyebrow: "LISTENING / 入力",
    titleJa: "聞いています",
    titleEn: "Listening · words arriving",
    accessibilityLabel:
      "Listening. Live transcript available below the voice plate.",
    plate: "listening",
  },
  understanding: {
    eyebrow: "UNDERSTANDING / 整理",
    titleJa: "受け取りました",
    titleEn: "Understanding",
    accessibilityLabel: "Speech received. Koe is understanding it.",
    plate: "understanding",
  },
  firstReply: {
    eyebrow: "REPLY / 応答",
    titleJa: "返事を整えています",
    titleEn: "A reply is forming",
    accessibilityLabel: "The first reply is ready and audio is starting.",
    plate: "understanding",
  },
  speaking: {
    eyebrow: "SPEAKING / 出力",
    titleJa: "話しています",
    titleEn: "Koe is speaking",
    accessibilityLabel: "Koe is speaking. You can interrupt at any time.",
    plate: "speaking",
  },
  interrupted: {
    eyebrow: "INTERRUPTED / 交替",
    titleJa: "あなたの番です",
    titleEn: "Your turn",
    accessibilityLabel: "Koe stopped speaking. It is your turn.",
    plate: "listening",
  },
  transcriptCheck: {
    eyebrow: "HEARD / 確認",
    titleJa: "こう聞こえました",
    titleEn: "Check the words",
    accessibilityLabel:
      "Check what Koe heard before sending. The captured words are shown below.",
    plate: "note",
  },
  feedback: {
    eyebrow: "ONE NOTE / 一点",
    titleJa: "ひとつ整える",
    titleEn: "One thing to tune",
    accessibilityLabel:
      "One pronunciation note is ready. Feedback is available without blocking the conversation.",
    plate: "note",
  },
  retryListening: {
    eyebrow: "RETRY / 再発話",
    titleJa: "もう一度",
    titleEn: "Listening for the retry",
    accessibilityLabel: "Listening for one pronunciation retry.",
    plate: "listening",
  },
  comparing: {
    eyebrow: "COMPARE / 比較",
    titleJa: "二つの声を比べます",
    titleEn: "Comparing both attempts",
    accessibilityLabel:
      "Comparing the original and retry pronunciation attempts.",
    plate: "understanding",
  },
  responseRetry: {
    eyebrow: "RECONNECT / 再応答",
    titleJa: "返事をつなぎ直します",
    titleEn: "Trying the reply again",
    accessibilityLabel: "Retrying an interrupted response from Koe.",
    plate: "understanding",
  },
  success: {
    eyebrow: "RESTORED / 続行",
    titleJa: "続けましょう",
    titleEn: "Keep going",
    accessibilityLabel:
      "The retry succeeded. Keep speaking whenever you are ready.",
    plate: "ready",
  },
  recoverableError: {
    eyebrow: "PAUSED / 停止",
    titleJa: "ひと休み",
    titleEn: "Voice paused",
    accessibilityLabel: "Voice is paused. A recovery action is available.",
    plate: "recovery",
  },
};

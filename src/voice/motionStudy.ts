import type { VoicePhase } from "@/voice/lifecycle";

export type StudyMode = "neutral" | "strictCoach" | "roleplay";

export type MotionStageId =
  | "enter"
  | "listen"
  | "interim"
  | "understand"
  | "firstReply"
  | "speak"
  | "bargeIn"
  | "feedback"
  | "retry"
  | "compare"
  | "continue";

export type StudyModeContract = {
  id: StudyMode;
  label: string;
  context: string;
  note: string;
  reply: string;
  correction: string;
};

export type MotionStudyStage = {
  id: MotionStageId;
  phase: VoicePhase;
  label: string;
  title: string;
  detail: string;
  utterance?: "learner" | "koe" | "correction" | "comparison";
  motionMs?: number;
  nextAction: string;
};

/**
 * Each mode uses the same learner line and pronunciation target so a study
 * compares coaching posture instead of accidentally comparing content.
 */
export const STUDY_MODES: readonly StudyModeContract[] = [
  {
    id: "neutral",
    label: "Neutral",
    context: "Open conversation",
    note: "Reply first. Offer one optional note after the turn.",
    reply: "いいですね。どんな映画でしたか？",
    correction:
      "One sound to tune: in 映画, let えい take two beats. Then keep going.",
  },
  {
    id: "strictCoach",
    label: "Strict coach",
    context: "Precision, when requested",
    note: "Be direct and specific without turning the exchange into a test.",
    reply: "いいですね。どんな映画でしたか？",
    correction:
      "映画 is え・い・が: three mora. Repeat 映画 once without shortening えい.",
  },
  {
    id: "roleplay",
    label: "Roleplay",
    context: "A friend at lunch",
    note: "Stay in the scene; place coaching after the character's reply.",
    reply: "へえ、どんな映画だった？",
    correction:
      "Quick note before we continue: keep both beats in えいが. Now tell me what happened.",
  },
] as const;

export const MOTION_STUDY_STAGES: readonly MotionStudyStage[] = [
  {
    id: "enter",
    phase: "idle",
    label: "ENTER / 入口",
    title: "話してみて",
    detail: "One obvious action; no scenario or lesson choice first.",
    nextAction: "Hold to speak",
  },
  {
    id: "listen",
    phase: "listening",
    label: "LISTEN / 入力",
    title: "聞いています",
    detail: "The seam opens with the learner's actual vocal energy.",
    utterance: "learner",
    nextAction: "Release",
  },
  {
    id: "interim",
    phase: "interimTranscript",
    label: "WORDS / 途中",
    title: "昨日、友達と映画を…",
    detail: "Words arrive beneath the same form; the state does not jump.",
    utterance: "learner",
    nextAction: "Finish the line",
  },
  {
    id: "understand",
    phase: "understanding",
    label: "UNDERSTAND / 整理",
    title: "受け取りました",
    detail: "The form narrows so waiting reads differently from silence.",
    motionMs: 420,
    nextAction: "First words arrive",
  },
  {
    id: "firstReply",
    phase: "firstReply",
    label: "FIRST REPLY / 応答",
    title: "いいですね。",
    detail: "Text appears before audio without pretending speech has begun.",
    utterance: "koe",
    motionMs: 180,
    nextAction: "Voice begins",
  },
  {
    id: "speak",
    phase: "speaking",
    label: "SPEAK / 出力",
    title: "Koe is speaking",
    detail: "Playback energy animates the same seam in the other direction.",
    utterance: "koe",
    nextAction: "Barge in",
  },
  {
    id: "bargeIn",
    phase: "interrupted",
    label: "BARGE-IN / 交替",
    title: "Your turn",
    detail: "Koe stops immediately; no error language and no lost turn.",
    nextAction: "Show the note",
  },
  {
    id: "feedback",
    phase: "feedback",
    label: "ONE NOTE / 一点",
    title: "One thing to tune",
    detail:
      "The reply has landed. Feedback is specific, optional, and separate.",
    utterance: "correction",
    nextAction: "Try the phrase once",
  },
  {
    id: "retry",
    phase: "retryListening",
    label: "RETRY / 再発話",
    title: "映画",
    detail: "Retry only the useful target—not the whole conversation turn.",
    utterance: "learner",
    nextAction: "Compare attempts",
  },
  {
    id: "compare",
    phase: "comparing",
    label: "COMPARE / 比較",
    title: "The long vowel held",
    detail: "Show the changed target, not an abstract overall score.",
    utterance: "comparison",
    motionMs: 520,
    nextAction: "Return to the conversation",
  },
  {
    id: "continue",
    phase: "success",
    label: "CONTINUE / 続行",
    title: "どんな映画でしたか？",
    detail:
      "The original question remains waiting; practice did not end the talk.",
    utterance: "koe",
    nextAction: "Run another loop",
  },
] as const;

export const STUDY_LEARNER_LINE = "昨日、友達と映画を見ました。";

export function studyMode(id: StudyMode): StudyModeContract {
  return STUDY_MODES.find((mode) => mode.id === id) ?? STUDY_MODES[0];
}

export function nextMotionStage(index: number): number {
  return (index + 1) % MOTION_STUDY_STAGES.length;
}

export const SONG_PROTOTYPE_LINE = {
  id: "sakura-opening",
  text: "さくら さくら",
  reading: "さくら さくら",
  meaning: "Cherry blossoms, cherry blossoms",
  startSeconds: 0.88,
  endSeconds: 5.2,
} as const;

export type SongPrototypeStage =
  | "song"
  | "line"
  | "listen"
  | "imitate"
  | "question"
  | "complete";

export type LineBoundaryAction = "continue" | "pause" | "restart";

const STAGE_ORDER: SongPrototypeStage[] = [
  "song",
  "line",
  "listen",
  "imitate",
  "question",
  "complete",
];

export function advanceSongPrototype(
  current: SongPrototypeStage,
  reached: SongPrototypeStage,
): SongPrototypeStage {
  return STAGE_ORDER.indexOf(reached) > STAGE_ORDER.indexOf(current)
    ? reached
    : current;
}

export function lineBoundaryAction(input: {
  currentSeconds: number;
  endSeconds: number;
  looping: boolean;
}): LineBoundaryAction {
  if (!Number.isFinite(input.currentSeconds)) return "continue";
  if (input.currentSeconds < input.endSeconds) return "continue";
  return input.looping ? "restart" : "pause";
}

export function lineProgress(
  currentSeconds: number,
  startSeconds = SONG_PROTOTYPE_LINE.startSeconds,
  endSeconds = SONG_PROTOTYPE_LINE.endSeconds,
): number {
  if (!Number.isFinite(currentSeconds) || endSeconds <= startSeconds) return 0;
  return Math.max(
    0,
    Math.min(1, (currentSeconds - startSeconds) / (endSeconds - startSeconds)),
  );
}

export type SongQuestionID = "repeat" | "phrasing";

export const SONG_QUESTIONS: Array<{
  id: SongQuestionID;
  prompt: string;
  answer: string;
}> = [
  {
    id: "repeat",
    prompt: "Why repeat さくら?",
    answer:
      "The repetition lingers on the image before the next thought arrives. Keep both words connected; let the second one feel like an echo, not a restart.",
  },
  {
    id: "phrasing",
    prompt: "Where should I breathe?",
    answer:
      "Treat さくら さくら as one short phrase. Take the breath before it, then carry the vowel and timing through both words.",
  },
];

export function answerSongQuestion(id: SongQuestionID): string {
  return SONG_QUESTIONS.find((question) => question.id === id)?.answer ?? "";
}

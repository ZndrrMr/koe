import type { VoicePhase } from "@/voice/lifecycle";

export const ENERGY_SAMPLE_COUNT = 15;

export type AcousticDirection = "voiceSeam" | "moraField" | "resonanceGate";

export type AcousticShape =
  | "resting"
  | "open"
  | "compressed"
  | "answering"
  | "broken"
  | "split"
  | "comparing"
  | "resolved";

export type AcousticPresentation = {
  eyebrow: string;
  titleJa: string;
  titleEn: string;
  accessibilityLabel: string;
  shape: AcousticShape;
  liveEnergy: boolean;
  processing: boolean;
};

export const ACOUSTIC_PRESENTATION: Record<VoicePhase, AcousticPresentation> = {
  idle: {
    eyebrow: "VOICE / 01",
    titleJa: "どうぞ",
    titleEn: "Ready when you are",
    accessibilityLabel: "Ready. Hold the speak control and talk.",
    shape: "resting",
    liveEnergy: false,
    processing: false,
  },
  listening: {
    eyebrow: "LISTENING / 入力",
    titleJa: "聞いています",
    titleEn: "Listening",
    accessibilityLabel: "Listening. The voice seam responds to your volume.",
    shape: "open",
    liveEnergy: true,
    processing: false,
  },
  interimTranscript: {
    eyebrow: "LISTENING / 入力",
    titleJa: "聞いています",
    titleEn: "Listening · words arriving",
    accessibilityLabel:
      "Listening. Live transcript available below the voice seam.",
    shape: "open",
    liveEnergy: true,
    processing: false,
  },
  understanding: {
    eyebrow: "UNDERSTANDING / 整理",
    titleJa: "受け取りました",
    titleEn: "Understanding",
    accessibilityLabel: "Speech received. Koe is understanding it.",
    shape: "compressed",
    liveEnergy: false,
    processing: true,
  },
  firstReply: {
    eyebrow: "REPLY / 応答",
    titleJa: "返事を整えています",
    titleEn: "A reply is forming",
    accessibilityLabel: "The first reply is ready and audio is starting.",
    shape: "answering",
    liveEnergy: false,
    processing: true,
  },
  speaking: {
    eyebrow: "SPEAKING / 出力",
    titleJa: "話しています",
    titleEn: "Koe is speaking",
    accessibilityLabel:
      "Koe is speaking. The voice seam responds to playback energy.",
    shape: "open",
    liveEnergy: true,
    processing: false,
  },
  interrupted: {
    eyebrow: "INTERRUPTED / 交替",
    titleJa: "あなたの番です",
    titleEn: "Your turn",
    accessibilityLabel: "Koe stopped speaking. It is your turn.",
    shape: "broken",
    liveEnergy: false,
    processing: false,
  },
  correction: {
    eyebrow: "HEARD / 確認",
    titleJa: "こう聞こえました",
    titleEn: "Check one line",
    accessibilityLabel:
      "Check what Koe heard. The original and corrected seams are separated.",
    shape: "split",
    liveEnergy: false,
    processing: false,
  },
  retry: {
    eyebrow: "RETRY / 再接続",
    titleJa: "もう一度",
    titleEn: "Trying again",
    accessibilityLabel:
      "Retrying. The previous and current seams are compared.",
    shape: "comparing",
    liveEnergy: false,
    processing: true,
  },
  success: {
    eyebrow: "RESTORED / 続行",
    titleJa: "届きました",
    titleEn: "Back with you",
    accessibilityLabel: "Retry succeeded. The two seams have joined.",
    shape: "resolved",
    liveEnergy: false,
    processing: false,
  },
  recoverableError: {
    eyebrow: "PAUSED / 停止",
    titleJa: "ひと休み",
    titleEn: "Voice paused",
    accessibilityLabel: "Voice is paused. A recovery action is available.",
    shape: "broken",
    liveEnergy: false,
    processing: false,
  },
};

export const INITIAL_ENERGY_TRACE = [
  0.05, 0.08, 0.1, 0.07, 0.12, 0.09, 0.14, 0.08, 0.11, 0.07, 0.1, 0.08, 0.06,
  0.08, 0.05,
];

export function clampEnergy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function advanceEnergyTrace(
  previous: readonly number[],
  phase: VoicePhase,
  energy: number,
): number[] {
  const source =
    previous.length === ENERGY_SAMPLE_COUNT ? previous : INITIAL_ENERGY_TRACE;
  const presentation = ACOUSTIC_PRESENTATION[phase];

  if (presentation.liveEnergy) {
    const measured = clampEnergy(energy);
    const last = source[source.length - 1] ?? 0;
    const smoothed = last * 0.38 + measured * 0.62;
    return [...source.slice(1), smoothed];
  }

  const multiplier =
    presentation.shape === "compressed"
      ? 0.72
      : presentation.shape === "answering"
        ? 0.84
        : presentation.shape === "resting"
          ? 0.58
          : presentation.shape === "resolved"
            ? 0.44
            : 0.94;
  return source.map((sample) => Math.max(0.035, sample * multiplier));
}

type RibbonOptions = {
  width: number;
  height: number;
  amplitude?: number;
  offsetX?: number;
};

function smoothOpenPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middleX = (previous.x + current.x) / 2;
    const middleY = (previous.y + current.y) / 2;
    path += ` Q ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${middleX.toFixed(2)} ${middleY.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  path += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return path;
}

export function voiceSeamPaths(
  trace: readonly number[],
  options: RibbonOptions,
): { envelope: string; center: string; halfWidths: number[] } {
  const { width, height, amplitude = 54, offsetX = 0 } = options;
  const samples =
    trace.length > 1 ? trace.map(clampEnergy) : INITIAL_ENERGY_TRACE;
  const centerX = width / 2 + offsetX;
  const top = 12;
  const usableHeight = Math.max(1, height - top * 2);
  const halfWidths = samples.map(
    (sample, index) => 2.4 + sample * amplitude * (0.84 + (index % 3) * 0.08),
  );
  const left = samples.map((sample, index) => ({
    x: centerX - halfWidths[index] * (0.82 + (index % 2) * 0.12),
    y: top + (index / (samples.length - 1)) * usableHeight,
  }));
  const right = samples
    .map((sample, index) => ({
      x: centerX + halfWidths[index] * (0.9 + ((index + 1) % 3) * 0.07),
      y: top + (index / (samples.length - 1)) * usableHeight,
    }))
    .reverse();
  const center = samples.map((sample, index) => ({
    x: centerX + (index % 2 ? -1 : 1) * sample * 5,
    y: top + (index / (samples.length - 1)) * usableHeight,
  }));

  return {
    envelope: `${smoothOpenPath(left)} ${smoothOpenPath(right).replace(/^M/, "L")} Z`,
    center: smoothOpenPath(center),
    halfWidths,
  };
}

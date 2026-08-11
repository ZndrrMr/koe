import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorCode,
} from "expo-speech-recognition";
import { useAudioRecorder, type AudioRecorder } from "expo-audio";
import { config } from "@/utils/config";

export type STTChunk = {
  text: string;
  isFinal: boolean;
  confidence: number;
};

export type STTFailureKind =
  | "permission-denied"
  | "network"
  | "interrupted"
  | "no-speech"
  | "cancelled"
  | "unavailable"
  | "failed";

export class STTError extends Error {
  constructor(
    public readonly kind: STTFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "STTError";
  }
}

export type STTHandle = {
  stop: () => Promise<{
    fullText: string;
    durationMs: number;
    audioUri: string;
  }>;
  cancel: () => Promise<void>;
};

function failureKind(code: ExpoSpeechRecognitionErrorCode): STTFailureKind {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "network":
      return "network";
    case "interrupted":
    case "audio-capture":
      return "interrupted";
    case "no-speech":
    case "speech-timeout":
      return "no-speech";
    case "aborted":
      return "cancelled";
    case "language-not-supported":
    case "busy":
      return "unavailable";
    default:
      return "failed";
  }
}

export async function ensurePermission(): Promise<boolean> {
  const status = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return status.granted;
}

export async function startStreaming(opts: {
  onChunk: (chunk: STTChunk) => void;
  onAudioEnergy?: (energy: number) => void;
  languageHint?: "ja" | "ja,en";
  /** Kept optional for pitch-drill callers created before native live recognition. */
  recorder?: AudioRecorder;
}): Promise<STTHandle> {
  const ok = await ensurePermission();
  if (!ok)
    throw new STTError(
      "permission-denied",
      "Microphone or speech recognition permission denied",
    );
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    throw new STTError(
      "unavailable",
      "Speech recognition is unavailable on this device",
    );
  }

  const startedAt = Date.now();
  let latestText = "";
  let audioUri = "";
  let recognitionError: STTError | undefined;
  let cancelled = false;
  let settled = false;
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
  });

  const listeners = [
    ExpoSpeechRecognitionModule.addListener("result", (event) => {
      const result = event.results[0];
      if (!result?.transcript) return;
      latestText = result.transcript;
      opts.onChunk({
        text: latestText,
        isFinal: event.isFinal,
        confidence: Math.max(0, result.confidence),
      });
    }),
    ExpoSpeechRecognitionModule.addListener("audioend", (event) => {
      audioUri = event.uri ?? audioUri;
    }),
    ExpoSpeechRecognitionModule.addListener("volumechange", (event) => {
      // Native metering is -2...10 and values below zero are inaudible.
      // Keep normalization here so visual consumers remain platform-agnostic.
      opts.onAudioEnergy?.(Math.max(0, Math.min(1, event.value / 10)));
    }),
    ExpoSpeechRecognitionModule.addListener("error", (event) => {
      const kind = failureKind(event.error);
      if (cancelled && kind === "cancelled") return;
      recognitionError = new STTError(
        kind,
        event.message || `Speech recognition ${event.error}`,
      );
      settle();
    }),
    ExpoSpeechRecognitionModule.addListener("end", settle),
  ];

  const cleanup = () => listeners.forEach((listener) => listener.remove());

  try {
    ExpoSpeechRecognitionModule.start({
      lang: opts.languageHint === "ja" ? "ja-JP" : "ja-JP",
      interimResults: true,
      maxAlternatives: 1,
      continuous: true,
      addsPunctuation: true,
      iosTaskHint: "dictation",
      iosVoiceProcessingEnabled: true,
      volumeChangeEventOptions: opts.onAudioEnergy
        ? { enabled: true, intervalMillis: 80 }
        : undefined,
      recordingOptions: ExpoSpeechRecognitionModule.supportsRecording()
        ? {
            persist: true,
            outputSampleRate: 16_000,
            outputEncoding: "pcmFormatInt16",
          }
        : undefined,
    });
  } catch (error) {
    cleanup();
    throw new STTError(
      "failed",
      error instanceof Error
        ? error.message
        : "Could not start speech recognition",
    );
  }

  const waitForFinish = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      finished,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 5_000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  };

  return {
    stop: async () => {
      try {
        ExpoSpeechRecognitionModule.stop();
        await waitForFinish();
        if (!settled) {
          ExpoSpeechRecognitionModule.abort();
          throw new STTError(
            "failed",
            "Speech recognition did not finish cleanly",
          );
        }
        if (recognitionError && recognitionError.kind !== "no-speech")
          throw recognitionError;
        return {
          fullText: latestText.trim(),
          durationMs: Date.now() - startedAt,
          audioUri,
        };
      } finally {
        cleanup();
      }
    },
    cancel: async () => {
      cancelled = true;
      try {
        ExpoSpeechRecognitionModule.abort();
        await waitForFinish();
      } finally {
        cleanup();
      }
    },
  };
}

export { useAudioRecorder };

export function workerConfigured() {
  return Boolean(config.workerUrl);
}

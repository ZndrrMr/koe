import {
  AudioManager,
  AudioRecorder,
  FileFormat,
  FilePreset,
  type Result,
} from "react-native-audio-api";

import { getJson } from "@/services/api";
import {
  float32ToPCM16,
  normalizedAudioEnergy,
  SONIOX_AUDIO_FORMAT,
  SONIOX_BUFFER_DURATION_MS,
  SONIOX_CHANNELS,
  SONIOX_REALTIME_MODEL,
  SONIOX_SAMPLE_RATE,
  SonioxTranscriptAccumulator,
  type SonioxMessage,
} from "@/services/sonioxRealtime";
import { config } from "@/utils/config";
import {
  errorName,
  voiceEvent,
  type VoiceTraceContext,
} from "@/utils/telemetry";

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

type SonioxTokenResponse = {
  token: string;
  url: string;
  expiresAt: number;
};

const SOCKET_CONNECT_TIMEOUT_MS = 8_000;
const SOCKET_FINALIZE_TIMEOUT_MS = 5_000;

export async function ensurePermission(): Promise<boolean> {
  return (await AudioManager.requestRecordingPermissions()) === "Granted";
}

export async function startStreaming(opts: {
  onChunk: (chunk: STTChunk) => void;
  onAudioEnergy?: (energy: number) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onRecognitionEnd?: () => void;
  onError?: (error: STTError) => void;
  languageHint?: "ja" | "ja,en";
  trace?: VoiceTraceContext;
}): Promise<STTHandle> {
  const languageHint = opts.languageHint ?? "ja,en";
  voiceEvent("stt_started", opts.trace, {
    path: "soniox-realtime",
    languageHint,
    model: SONIOX_REALTIME_MODEL,
  });

  const ok = await ensurePermission();
  if (!ok) {
    voiceEvent(
      "stt_failed",
      opts.trace,
      { failureKind: "permission-denied", stage: "permission" },
      "error",
    );
    throw new STTError("permission-denied", "Microphone permission denied");
  }

  let tokenResponse: SonioxTokenResponse;
  try {
    tokenResponse = await getJson<SonioxTokenResponse>("/stt/token", {
      headers: {
        "X-Koe-Session-Id": opts.trace?.sessionId ?? "",
        "X-Koe-Turn-Id": opts.trace?.turnId ?? "",
      },
    });
    if (!tokenResponse.token || !tokenResponse.url) {
      throw new Error("Worker returned an incomplete Soniox token");
    }
  } catch (error) {
    voiceEvent(
      "stt_failed",
      opts.trace,
      {
        path: "soniox-realtime",
        failureKind: "network",
        stage: "temporary-key",
        errorName: errorName(error),
      },
      "error",
    );
    throw new STTError(
      "network",
      "Could not start bilingual speech recognition",
    );
  }

  const startedAt = Date.now();
  const recorder = new AudioRecorder();
  const transcript = new SonioxTranscriptAccumulator();
  const socket = new WebSocket(tokenResponse.url);
  let latestText = "";
  let audioUri = "";
  let streamError: STTError | undefined;
  let cancelled = false;
  let stopping = false;
  let finishedByProvider = false;
  let speechStarted = false;
  let lastChunkText = "";
  let lastChunkWasFinal = false;

  let settleSocket!: () => void;
  const socketFinished = new Promise<void>((resolve) => {
    settleSocket = resolve;
  });

  const reportStreamFailure = (error: STTError) => {
    if (streamError || cancelled || finishedByProvider) return;
    streamError = error;
    voiceEvent(
      "stt_failed",
      opts.trace,
      {
        path: "soniox-realtime",
        failureKind: error.kind,
        stage: "websocket",
      },
      "error",
    );
    opts.onError?.(error);
    settleSocket();
  };

  const socketReady = new Promise<void>((resolve, reject) => {
    let connected = false;
    const timeout = setTimeout(() => {
      if (connected) return;
      reject(
        new STTError(
          "network",
          "Bilingual speech recognition could not connect",
        ),
      );
      socket.close();
    }, SOCKET_CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify({
            api_key: tokenResponse.token,
            model: SONIOX_REALTIME_MODEL,
            audio_format: SONIOX_AUDIO_FORMAT,
            sample_rate: SONIOX_SAMPLE_RATE,
            num_channels: SONIOX_CHANNELS,
            language_hints: languageHint === "ja" ? ["ja"] : ["ja", "en"],
            enable_language_identification: true,
            enable_endpoint_detection: true,
            endpoint_latency_adjustment_level: 2,
            endpoint_sensitivity: 0.3,
            max_endpoint_delay_ms: 1_500,
            context: {
              general: [
                { key: "domain", value: "Japanese language learning" },
                {
                  key: "conversation",
                  value: "Natural English and Japanese code-switching",
                },
              ],
            },
          }),
        );
        connected = true;
        clearTimeout(timeout);
        voiceEvent("stt_provider_connected", opts.trace, {
          path: "soniox-realtime",
          model: SONIOX_REALTIME_MODEL,
          declaredEncoding: SONIOX_AUDIO_FORMAT,
          sampleRate: SONIOX_SAMPLE_RATE,
          channels: SONIOX_CHANNELS,
        });
        resolve();
      } catch (error) {
        clearTimeout(timeout);
        reject(
          new STTError(
            "network",
            error instanceof Error
              ? error.message
              : "Could not configure bilingual speech recognition",
          ),
        );
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: SonioxMessage;
      try {
        message = JSON.parse(event.data) as SonioxMessage;
      } catch {
        reportStreamFailure(
          new STTError("failed", "Speech provider returned malformed data"),
        );
        return;
      }
      if (message.error_code) {
        reportStreamFailure(
          new STTError(
            message.error_code >= 500 ? "network" : "unavailable",
            message.error_message ||
              `Speech provider returned ${message.error_type ?? message.error_code}`,
          ),
        );
        return;
      }

      const update = transcript.apply(message);
      latestText = update.text;
      if (
        update.text &&
        (update.text !== lastChunkText || update.isFinal !== lastChunkWasFinal)
      ) {
        lastChunkText = update.text;
        lastChunkWasFinal = update.isFinal;
        voiceEvent(update.isFinal ? "stt_final" : "stt_interim", opts.trace, {
          path: "soniox-realtime",
          transcriptChars: update.text.length,
          confidence: update.confidence,
          detectedLanguages: update.languages.join(",") || "unknown",
        });
        opts.onChunk({
          text: update.text,
          isFinal: update.isFinal,
          confidence: update.confidence,
        });
      }
      if (update.endpoint && !stopping && !cancelled) {
        voiceEvent("stt_semantic_endpoint", opts.trace, {
          path: "soniox-realtime",
          detectedLanguages: update.languages.join(",") || "unknown",
        });
        opts.onRecognitionEnd?.();
      }
      if (update.finished) {
        finishedByProvider = true;
        settleSocket();
      }
    };

    socket.onerror = () => {
      const error = new STTError(
        "network",
        "Bilingual speech recognition connection failed",
      );
      if (!connected) {
        clearTimeout(timeout);
        reject(error);
      } else {
        reportStreamFailure(error);
      }
    };

    socket.onclose = () => {
      clearTimeout(timeout);
      if (!connected && !cancelled) {
        reject(
          new STTError(
            "network",
            "Bilingual speech recognition closed before it was ready",
          ),
        );
      } else if (!finishedByProvider && !cancelled && !stopping) {
        reportStreamFailure(
          new STTError(
            "network",
            "Bilingual speech recognition ended unexpectedly",
          ),
        );
      }
      settleSocket();
    };
  });

  const deactivateAudioSession = async () => {
    try {
      await AudioManager.setAudioSessionActivity(false);
    } catch (error) {
      voiceEvent(
        "audio_session_failed",
        opts.trace,
        {
          path: "recording-deactivation",
          errorName: errorName(error),
        },
        "warn",
      );
    }
  };

  const cleanupRecorder = () => {
    recorder.clearOnAudioReady();
    recorder.clearOnError();
  };

  try {
    AudioManager.setAudioSessionOptions({
      iosCategory: "playAndRecord",
      iosMode: "voiceChat",
      iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
      iosNotifyOthersOnDeactivation: true,
    });
    await AudioManager.setAudioSessionActivity(true);
    assertAudioResult(
      recorder.enableFileOutput({
        channelCount: SONIOX_CHANNELS,
        format: FileFormat.Wav,
        preset: { ...FilePreset.Low, sampleRate: SONIOX_SAMPLE_RATE },
        fileNamePrefix: "koe-turn",
      }),
      "Could not configure microphone recording",
    );
    assertAudioResult(
      recorder.onAudioReady(
        {
          sampleRate: SONIOX_SAMPLE_RATE,
          bufferLength:
            (SONIOX_SAMPLE_RATE * SONIOX_BUFFER_DURATION_MS) / 1_000,
          channelCount: SONIOX_CHANNELS,
        },
        ({ buffer }) => {
          const samples = buffer.getChannelData(0);
          const energy = normalizedAudioEnergy(samples);
          opts.onAudioEnergy?.(energy);
          if (!speechStarted && energy >= 0.06) {
            speechStarted = true;
            opts.onSpeechStart?.();
          }
          if (socket.readyState === WebSocket.OPEN && !stopping && !cancelled) {
            socket.send(float32ToPCM16(samples));
          }
        },
      ),
      "Could not stream microphone audio",
    );
    recorder.onError(({ message }) => {
      reportStreamFailure(
        new STTError("interrupted", message || "Microphone capture failed"),
      );
    });
    await socketReady;
    if (streamError) throw streamError;
    assertAudioResult(
      await recorder.start(),
      "Could not start microphone recording",
    );
    if (streamError) throw streamError;
    voiceEvent("audio_session_ready", opts.trace, {
      path: "soniox-realtime",
      category: "playAndRecord",
      mode: "voiceChat",
      options: "defaultToSpeaker,allowBluetoothHFP",
      route: "system-selected",
      sampleRate: SONIOX_SAMPLE_RATE,
      channels: SONIOX_CHANNELS,
      declaredEncoding: SONIOX_AUDIO_FORMAT,
    });
    voiceEvent("microphone_capture_started", opts.trace, {
      path: "react-native-audio-api",
      sampleRate: SONIOX_SAMPLE_RATE,
      channels: SONIOX_CHANNELS,
    });
  } catch (error) {
    cancelled = true;
    cleanupRecorder();
    if (recorder.isRecording()) await recorder.stop().catch(() => undefined);
    socket.close();
    await deactivateAudioSession();
    voiceEvent(
      "audio_session_failed",
      opts.trace,
      { path: "recording", errorName: errorName(error) },
      "error",
    );
    throw error instanceof STTError
      ? error
      : new STTError(
          "failed",
          error instanceof Error
            ? error.message
            : "Could not start speech recognition",
        );
  }

  return {
    stop: async () => {
      stopping = true;
      let stopped: Awaited<ReturnType<AudioRecorder["stop"]>> | undefined;
      try {
        stopped = await recorder.stop();
        cleanupRecorder();
        if (stopped.status === "success") audioUri = stopped.paths[0] ?? "";
        if (socket.readyState === WebSocket.OPEN) socket.send("");
        await Promise.race([
          socketFinished,
          new Promise<void>((resolve) =>
            setTimeout(resolve, SOCKET_FINALIZE_TIMEOUT_MS),
          ),
        ]);
        if (!finishedByProvider) socket.close();
        if (streamError && !latestText.trim()) throw streamError;
        if (!latestText.trim()) {
          throw new STTError("no-speech", "No speech was recognized");
        }
        voiceEvent("stt_completed", opts.trace, {
          path: "soniox-realtime",
          transcriptChars: latestText.trim().length,
          durationMs: Date.now() - startedAt,
          capturedAudio: Boolean(audioUri),
        });
        return {
          fullText: latestText.trim(),
          durationMs: Date.now() - startedAt,
          audioUri,
        };
      } finally {
        cleanupRecorder();
        await deactivateAudioSession();
        voiceEvent("microphone_capture_ended", opts.trace, {
          path: "react-native-audio-api",
          durationMs: Date.now() - startedAt,
          capturedAudio: Boolean(audioUri),
          failed: Boolean(streamError || stopped?.status === "error"),
        });
      }
    },
    cancel: async () => {
      if (cancelled || stopping) return;
      cancelled = true;
      stopping = true;
      voiceEvent(
        "stt_cancelled",
        opts.trace,
        { durationMs: Date.now() - startedAt },
        "warn",
      );
      try {
        cleanupRecorder();
        if (recorder.isRecording()) await recorder.stop();
        socket.close();
      } finally {
        await deactivateAudioSession();
        voiceEvent("microphone_capture_ended", opts.trace, {
          path: "react-native-audio-api",
          durationMs: Date.now() - startedAt,
          cancelled: true,
        });
      }
    },
  };
}

function assertAudioResult<T>(
  result: Result<T>,
  fallback: string,
): asserts result is {
  status: "success";
} & T {
  if (result.status === "error") {
    throw new STTError("interrupted", result.message || fallback);
  }
}

export function workerConfigured() {
  return Boolean(config.workerUrl);
}

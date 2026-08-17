import {
  errorName,
  voiceEvent,
  type VoiceTraceContext,
} from "@/utils/telemetry";
import {
  RECORDED_AUDIO_CANONICAL_MIME,
  RECORDED_AUDIO_MAX_BYTES,
  RecordedAudioContractError,
  formatForRecordedAudioFilename,
  validateRecordedAudioEnvelope,
  type RecordedAudioFailureKind,
  type RecordedAudioMetadata,
} from "../../shared/recordedAudio";

export type RecordedAudioInput = {
  uri: string;
  filename?: string;
  mimeType?: string;
};

export type RecordedAudioTranscription = {
  text: string;
  audioUri: string;
  metadata: RecordedAudioMetadata;
};

export type RecordedAudioInputFailureKind =
  | RecordedAudioFailureKind
  | "file-unavailable"
  | "decode-failed"
  | "network"
  | "provider";

export class RecordedAudioInputError extends Error {
  constructor(
    public readonly kind: RecordedAudioInputFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RecordedAudioInputError";
  }
}

export type RecordedAudioFile = Blob & {
  uri: string;
  name: string;
  type: string;
  size: number;
  exists: boolean;
};

export type RecordedAudioInputRuntime = {
  materialize: (input: RecordedAudioInput) => Promise<RecordedAudioFile>;
  decode: (uri: string) => Promise<{
    numberOfChannels: number;
    sampleRate: number;
    length: number;
  }>;
  transcribe: (
    encodedBytes: Uint8Array,
    metadata: RecordedAudioMetadata,
    trace: VoiceTraceContext,
  ) => Promise<{ text: string; audio?: RecordedAudioMetadata }>;
};

export async function transcribeRecordedAudio(
  input: RecordedAudioInput,
  trace: VoiceTraceContext,
  runtime: RecordedAudioInputRuntime = nativeRecordedAudioRuntime,
): Promise<RecordedAudioTranscription> {
  let file: RecordedAudioFile;
  try {
    file = await runtime.materialize(input);
  } catch (error) {
    throw inputError(
      "file-unavailable",
      "Recorded audio file could not be opened",
      error,
    );
  }
  if (!file.exists) {
    throw new RecordedAudioInputError(
      "file-unavailable",
      "Recorded audio file does not exist",
    );
  }
  if (file.size > RECORDED_AUDIO_MAX_BYTES) {
    throw new RecordedAudioInputError(
      "audio-too-large",
      `Recorded audio exceeds the ${RECORDED_AUDIO_MAX_BYTES}-byte limit`,
    );
  }

  const filename = input.filename ?? file.name;
  let decoded: Awaited<ReturnType<RecordedAudioInputRuntime["decode"]>>;
  let encodedBytes: Uint8Array;
  try {
    [decoded, encodedBytes] = await Promise.all([
      runtime.decode(file.uri),
      file.arrayBuffer().then((bytes) => new Uint8Array(bytes)),
    ]);
  } catch (error) {
    voiceEvent(
      "stt_failed",
      trace,
      {
        path: "recorded-file",
        failureKind: "decode-failed",
        errorName: errorName(error),
      },
      "error",
    );
    throw inputError(
      "decode-failed",
      "Recorded audio could not be decoded",
      error,
    );
  }

  let metadata: RecordedAudioMetadata;
  try {
    const format = formatForRecordedAudioFilename(filename);
    metadata = validateRecordedAudioEnvelope({
      filename,
      mimeType:
        input.mimeType || file.type || RECORDED_AUDIO_CANONICAL_MIME[format],
      bytes: encodedBytes,
      byteCount: file.size,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      durationMs: (decoded.length / decoded.sampleRate) * 1_000,
    });
  } catch (error) {
    if (error instanceof RecordedAudioContractError) {
      voiceEvent(
        "stt_failed",
        trace,
        {
          path: "recorded-file",
          failureKind: error.kind,
          stage: "file-validation",
          byteCount: file.size,
        },
        "error",
      );
      throw new RecordedAudioInputError(error.kind, error.message, {
        cause: error,
      });
    }
    throw error;
  }

  voiceEvent("recorded_audio_validated", trace, {
    path: "recorded-file",
    declaredEncoding: metadata.format,
    observedEncoding: metadata.format,
    contentType: metadata.mimeType,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    durationMs: Math.round(metadata.durationMs),
    byteCount: metadata.byteCount,
  });
  voiceEvent("stt_started", trace, {
    path: "async-rest-recorded-file",
    declaredEncoding: metadata.format,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    durationMs: Math.round(metadata.durationMs),
    byteCount: metadata.byteCount,
  });

  let response: { text: string; audio?: RecordedAudioMetadata };
  try {
    response = await runtime.transcribe(encodedBytes, metadata, trace);
  } catch (error) {
    const kind =
      error instanceof RecordedAudioInputError ? error.kind : "network";
    voiceEvent(
      "stt_failed",
      trace,
      {
        path: "async-rest-recorded-file",
        failureKind: kind,
        stage: "worker-transcription",
        errorName: errorName(error),
        errorMessage:
          error instanceof Error ? error.message.slice(0, 160) : "unknown",
      },
      "error",
    );
    throw error instanceof RecordedAudioInputError
      ? error
      : inputError("network", "Recorded audio transcription failed", error);
  }

  const text = response.text.trim();
  if (!text) {
    throw new RecordedAudioInputError(
      "provider",
      "Recorded audio transcription returned no speech",
    );
  }
  if (response.audio) {
    assertMetadataRoundTrip(metadata, response.audio);
  } else {
    // Older deployed Workers return only {text}. The app already decoded and
    // validated the exact local bytes before upload, so it can safely retain
    // that local metadata while making the deployment drift observable.
    voiceEvent(
      "stt_metadata_fallback",
      trace,
      {
        path: "worker-json-compat",
        failureKind: "metadata-missing",
        declaredEncoding: metadata.format,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        byteCount: metadata.byteCount,
      },
      "warn",
    );
  }
  voiceEvent("stt_final", trace, {
    path: "async-rest-recorded-file",
    transcriptChars: text.length,
    confidence: 0,
  });
  voiceEvent("stt_completed", trace, {
    path: "async-rest-recorded-file",
    transcriptChars: text.length,
    durationMs: Math.round(metadata.durationMs),
    capturedAudio: true,
  });
  return { text, audioUri: file.uri, metadata };
}

const nativeRecordedAudioRuntime: RecordedAudioInputRuntime = {
  materialize: async (input) => {
    const { File, Paths } = await import("expo-file-system");
    if (/^https?:\/\//i.test(input.uri)) {
      const filename = input.filename ?? filenameFromUri(input.uri);
      formatForRecordedAudioFilename(filename);
      const destination = new File(
        Paths.cache,
        `recorded-input-${Date.now()}-${filename}`,
      );
      return (await File.downloadFileAsync(input.uri, destination, {
        idempotent: true,
      })) as RecordedAudioFile;
    }
    return new File(input.uri) as RecordedAudioFile;
  },
  decode: async (uri) => {
    const { decodeAudioData } = await import("react-native-audio-api");
    return decodeAudioData(uri);
  },
  transcribe: async (encodedBytes, metadata, trace) => {
    const [{ fetch: expoFetch }, { authHeaders, workerUrl }] =
      await Promise.all([import("expo/fetch"), import("@/services/api")]);
    const response = await expoFetch(workerUrl("/stt/transcribe?lang=ja,en"), {
      method: "POST",
      headers: {
        ...authHeaders({
          "X-Koe-Session-Id": trace.sessionId ?? "",
          "X-Koe-Turn-Id": trace.turnId ?? "",
          "X-Koe-Response-Run-Id": trace.responseRunId ?? "",
        }),
        "Content-Type": metadata.mimeType,
        "X-Koe-Audio-Filename": encodeURIComponent(metadata.filename),
        "X-Koe-Audio-Sample-Rate": String(metadata.sampleRate),
        "X-Koe-Audio-Channels": String(metadata.channels),
        "X-Koe-Audio-Duration-Ms": String(Math.round(metadata.durationMs)),
      },
      // Expo's native fetch normalizes typed arrays into an exact request body.
      // Passing an expo-file-system File here is not portable across native
      // fetch implementations even though File implements the Blob interface.
      body: encodedBytes.buffer.slice(
        encodedBytes.byteOffset,
        encodedBytes.byteOffset + encodedBytes.byteLength,
      ) as ArrayBuffer,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: { code?: RecordedAudioInputFailureKind; message?: string } }
        | undefined;
      throw new RecordedAudioInputError(
        payload?.error?.code ??
          (response.status >= 500 ? "provider" : "invalid-audio"),
        payload?.error?.message ??
          `Recorded audio request failed with status ${response.status}`,
      );
    }
    return (await response.json()) as {
      text: string;
      audio?: RecordedAudioMetadata;
    };
  },
};

function filenameFromUri(uri: string): string {
  const pathname = new URL(uri).pathname;
  const encoded = pathname.split("/").filter(Boolean).pop();
  if (!encoded) {
    throw new RecordedAudioInputError(
      "unsupported-audio",
      "Recorded audio URL must end in an MP3, M4A, or WAV filename",
    );
  }
  return decodeURIComponent(encoded);
}

function assertMetadataRoundTrip(
  sent: RecordedAudioMetadata,
  returned: RecordedAudioMetadata,
): void {
  if (
    !returned ||
    returned.filename !== sent.filename ||
    returned.mimeType !== sent.mimeType ||
    returned.format !== sent.format ||
    returned.byteCount !== sent.byteCount ||
    returned.sampleRate !== sent.sampleRate ||
    returned.channels !== sent.channels ||
    Math.abs(returned.durationMs - sent.durationMs) > 1
  ) {
    throw new RecordedAudioInputError(
      "audio-metadata-mismatch",
      "Worker did not preserve recorded audio metadata",
    );
  }
}

function inputError(
  kind: RecordedAudioInputFailureKind,
  message: string,
  cause: unknown,
): RecordedAudioInputError {
  return new RecordedAudioInputError(kind, message, { cause });
}

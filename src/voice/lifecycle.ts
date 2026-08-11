export type VoicePhase =
  | "idle"
  | "listening"
  | "interimTranscript"
  | "understanding"
  | "firstReply"
  | "speaking"
  | "interrupted"
  | "correction"
  | "retry"
  | "recoverableError";

export type VoiceErrorKind =
  | "silence"
  | "cancelled"
  | "permissionDenied"
  | "network"
  | "sttFailure"
  | "providerTimeout"
  | "audioInterruption"
  | "playbackFailure";

export type VoiceRecoveryAction =
  | "listenAgain"
  | "retryResponse"
  | "openSettings"
  | "resume";

export type VoiceLifecycle = {
  phase: VoicePhase;
  interimTranscript: string;
  errorKind?: VoiceErrorKind;
  message?: string;
  recovery?: VoiceRecoveryAction;
};

export const INITIAL_VOICE_LIFECYCLE: VoiceLifecycle = {
  phase: "idle",
  interimTranscript: "",
};

export const VOICE_PHASE_COPY: Record<
  VoicePhase,
  { title: string; detail: string }
> = {
  idle: { title: "Ready", detail: "Hold the mic and speak." },
  listening: { title: "Listening…", detail: "Speak naturally, then release." },
  interimTranscript: {
    title: "Hearing you…",
    detail: "The transcript updates while you speak.",
  },
  understanding: {
    title: "Understanding…",
    detail: "Koe is preparing a response.",
  },
  firstReply: { title: "Replying…", detail: "The first words are ready." },
  speaking: { title: "Koe is speaking", detail: "Hold the mic to interrupt." },
  interrupted: { title: "Interrupted", detail: "Koe stopped. Your turn." },
  correction: {
    title: "Check what Koe heard",
    detail: "Edit the transcript or try again.",
  },
  retry: { title: "Retrying…", detail: "Reconnecting to the voice provider." },
  recoverableError: {
    title: "Voice paused",
    detail: "Choose a recovery action below.",
  },
};

const ERROR_RECOVERY: Record<
  Exclude<VoiceErrorKind, "cancelled">,
  { message: string; recovery: VoiceRecoveryAction }
> = {
  silence: { message: "I did not catch any speech.", recovery: "listenAgain" },
  permissionDenied: {
    message: "Microphone and speech recognition access are required.",
    recovery: "openSettings",
  },
  network: {
    message: "The network connection was interrupted.",
    recovery: "retryResponse",
  },
  sttFailure: {
    message: "Speech recognition stopped unexpectedly.",
    recovery: "listenAgain",
  },
  providerTimeout: {
    message: "The voice provider took too long to respond.",
    recovery: "retryResponse",
  },
  audioInterruption: {
    message: "Another audio session interrupted the microphone.",
    recovery: "resume",
  },
  playbackFailure: {
    message: "Koe could not play the response audio.",
    recovery: "retryResponse",
  },
};

export function voiceError(
  kind: Exclude<VoiceErrorKind, "cancelled">,
  message?: string,
): VoiceLifecycle {
  const fallback = ERROR_RECOVERY[kind];
  return {
    phase: "recoverableError",
    interimTranscript: "",
    errorKind: kind,
    message: message || fallback.message,
    recovery: fallback.recovery,
  };
}

export type VoiceLatency = {
  listeningToTranscriptMs?: number;
  transcriptToFirstTextMs?: number;
  firstTextToFirstAudioMs?: number;
};

export class VoiceLatencyTracker {
  private listeningAt?: number;
  private firstTranscriptAt?: number;
  private transcriptCommittedAt?: number;
  private firstTextAt?: number;
  private firstAudioAt?: number;

  constructor(private readonly now: () => number = () => Date.now()) {}

  listeningStarted(): void {
    this.listeningAt = this.now();
  }

  transcriptReceived(): VoiceLatency {
    if (this.firstTranscriptAt === undefined)
      this.firstTranscriptAt = this.now();
    return this.snapshot();
  }

  transcriptCommitted(): void {
    this.transcriptCommittedAt = this.now();
  }

  firstTextReceived(): VoiceLatency {
    if (this.firstTextAt === undefined) this.firstTextAt = this.now();
    return this.snapshot();
  }

  firstAudioPlayed(): VoiceLatency {
    if (this.firstAudioAt === undefined) this.firstAudioAt = this.now();
    return this.snapshot();
  }

  snapshot(): VoiceLatency {
    return {
      listeningToTranscriptMs:
        this.listeningAt !== undefined && this.firstTranscriptAt !== undefined
          ? Math.max(0, this.firstTranscriptAt - this.listeningAt)
          : undefined,
      transcriptToFirstTextMs:
        (this.transcriptCommittedAt ?? this.firstTranscriptAt) !== undefined &&
        this.firstTextAt !== undefined
          ? Math.max(
              0,
              this.firstTextAt -
                (this.transcriptCommittedAt ?? this.firstTranscriptAt)!,
            )
          : undefined,
      firstTextToFirstAudioMs:
        this.firstTextAt !== undefined && this.firstAudioAt !== undefined
          ? Math.max(0, this.firstAudioAt - this.firstTextAt)
          : undefined,
    };
  }
}

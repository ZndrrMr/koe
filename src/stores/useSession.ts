import { create } from "zustand";
import {
  completeSession,
  loadSession,
  persistSession,
  persistTurn,
  prepareSessionCloseout,
  setLearningMomentDecision,
} from "@/db";
import {
  withMomentDecision,
  type LearningMomentDecision,
  type SessionCloseout,
  type SessionTurnSnapshot,
} from "@/db/sessionHistory";
import { log } from "@/utils/log";
import {
  errorName,
  voiceEvent,
  type VoiceTraceContext,
} from "@/utils/telemetry";
import {
  INITIAL_VOICE_LIFECYCLE,
  type VoiceLatency,
  type VoiceLifecycle,
  type VoicePhase,
} from "@/voice/lifecycle";

export type ChatTurn = SessionTurnSnapshot & {
  traceTurnId?: string;
  responseRunId?: string;
};

type SessionState = {
  id: string | null;
  turns: ChatTurn[];
  hydration: "idle" | "loading" | "ready";
  closeout: SessionCloseout | null;
  isRecording: boolean;
  isStreaming: boolean;
  voice: VoiceLifecycle;
  latency: VoiceLatency;
  traceContext: VoiceTraceContext;

  start: (id: string) => Promise<void>;
  addTurn: (turn: ChatTurn) => void;
  patchTurn: (id: string, patch: Partial<ChatTurn>) => void;
  appendAssistantText: (id: string, chunk: string) => void;
  setRecording: (value: boolean) => void;
  setStreaming: (value: boolean) => void;
  setVoice: (voice: VoiceLifecycle) => void;
  setVoicePhase: (phase: VoicePhase, patch?: Partial<VoiceLifecycle>) => void;
  setInterimTranscript: (text: string) => void;
  setLatency: (latency: VoiceLatency) => void;
  setTraceContext: (trace: Omit<VoiceTraceContext, "sessionId">) => void;
  prepareCloseout: () => Promise<SessionCloseout | null>;
  setMomentDecision: (
    momentId: string,
    decision: LearningMomentDecision,
  ) => Promise<void>;
  end: () => Promise<void>;
};

const sessionPersistence = new Map<string, Promise<void>>();
const turnPersistence = new Map<string, Promise<void>>();

function mergeTurns(persisted: ChatTurn[], inMemory: ChatTurn[]): ChatTurn[] {
  const turns = new Map(persisted.map((turn) => [turn.id, turn]));
  for (const turn of inMemory) turns.set(turn.id, turn);
  return [...turns.values()].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

export const useSession = create<SessionState>((set, get) => ({
  id: null,
  turns: [],
  hydration: "idle",
  closeout: null,
  isRecording: false,
  isStreaming: false,
  voice: INITIAL_VOICE_LIFECYCLE,
  latency: {},
  traceContext: {},
  start: async (id) => {
    set({
      id,
      turns: [],
      hydration: "loading",
      closeout: null,
      isRecording: false,
      isStreaming: false,
      voice: INITIAL_VOICE_LIFECYCLE,
      latency: {},
      traceContext: { sessionId: id },
    });
    voiceEvent("session_started", { sessionId: id });
    const ready = persistSession({ id });
    sessionPersistence.set(id, ready);
    try {
      await ready;
      const restored = await loadSession(id);
      if (get().id !== id) return;
      set((state) => ({
        turns: mergeTurns(restored?.turns ?? [], state.turns),
        closeout: restored?.closeout ?? null,
        hydration: "ready",
      }));
    } catch (error) {
      log.warn("Could not restore session", error);
      if (get().id === id) set({ hydration: "ready" });
    }
  },
  addTurn: (turn) => {
    set((state) => ({ turns: mergeTurns(state.turns, [turn]) }));
    persistChatTurn(get().id, turn);
  },
  patchTurn: (id, patch) => {
    set((state) => ({
      turns: state.turns.map((turn) =>
        turn.id === id ? { ...turn, ...patch } : turn,
      ),
    }));
    const turn = get().turns.find((candidate) => candidate.id === id);
    if (turn) persistChatTurn(get().id, turn);
  },
  appendAssistantText: (id, chunk) => {
    set((state) => ({
      turns: state.turns.map((turn) =>
        turn.id === id ? { ...turn, textJa: turn.textJa + chunk } : turn,
      ),
    }));
    const turn = get().turns.find((candidate) => candidate.id === id);
    if (turn) persistChatTurn(get().id, turn);
  },
  setRecording: (value) => set({ isRecording: value }),
  setStreaming: (value) => set({ isStreaming: value }),
  setVoice: (voice) => {
    voiceEvent(
      "lifecycle_transition",
      get().traceContext,
      {
        fromPhase: get().voice.phase,
        toPhase: voice.phase,
        failureKind: voice.errorKind,
        uiState: voice.phase,
      },
      voice.phase === "recoverableError" ? "error" : "info",
    );
    set({ voice });
  },
  setVoicePhase: (phase, patch = {}) => {
    voiceEvent("lifecycle_transition", get().traceContext, {
      fromPhase: get().voice.phase,
      toPhase: phase,
      uiState: phase,
    });
    set((state) => ({
      voice: {
        ...state.voice,
        errorKind: undefined,
        message: undefined,
        recovery: undefined,
        ...patch,
        phase,
      },
    }));
  },
  setInterimTranscript: (interimTranscript) => {
    const phase = interimTranscript ? "interimTranscript" : "listening";
    if (phase !== get().voice.phase) {
      voiceEvent("lifecycle_transition", get().traceContext, {
        fromPhase: get().voice.phase,
        toPhase: phase,
        uiState: phase,
      });
    }
    set((state) => ({
      voice: {
        ...state.voice,
        phase,
        interimTranscript,
      },
    }));
  },
  setLatency: (latency) => set({ latency }),
  setTraceContext: (trace) =>
    set((state) => ({
      traceContext: { sessionId: state.id ?? undefined, ...trace },
    })),
  prepareCloseout: async () => {
    const sessionId = get().id;
    if (!sessionId) return null;
    await flushSessionPersistence(sessionId);
    try {
      const closeout = await prepareSessionCloseout(sessionId, get().turns);
      if (get().id === sessionId) set({ closeout });
      return closeout;
    } catch (error) {
      log.warn("Could not prepare session closeout", error);
      return null;
    }
  },
  setMomentDecision: async (momentId, decision) => {
    const sessionId = get().id;
    if (!sessionId) return;
    const current = get().closeout ?? (await get().prepareCloseout());
    if (!current || get().id !== sessionId) return;
    set({ closeout: withMomentDecision(current, momentId, decision) });
    try {
      await setLearningMomentDecision(sessionId, momentId, decision);
    } catch (error) {
      log.warn("Could not update saved moment", error);
      if (get().id === sessionId) set({ closeout: current });
    }
  },
  end: async () => {
    const sessionId = get().id;
    if (!sessionId) return;
    await flushSessionPersistence(sessionId);
    try {
      await completeSession(sessionId, get().turns);
    } catch (error) {
      log.warn("Could not complete session", error);
      throw error;
    }
    if (get().id !== sessionId) return;
    set({
      id: null,
      turns: [],
      hydration: "idle",
      closeout: null,
      isRecording: false,
      isStreaming: false,
      voice: INITIAL_VOICE_LIFECYCLE,
      latency: {},
      traceContext: {},
    });
  },
}));

async function flushSessionPersistence(sessionId: string): Promise<void> {
  await sessionPersistence.get(sessionId);
  const prefix = `${sessionId}:`;
  await Promise.all(
    [...turnPersistence.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, ready]) => ready),
  );
}

function persistChatTurn(sessionId: string | null, turn: ChatTurn) {
  if (!sessionId) return;
  const pronunciation = turn.pronunciation;
  const key = `${sessionId}:${turn.id}`;
  const sessionReady = sessionPersistence.get(sessionId) ?? Promise.resolve();
  const ready = (turnPersistence.get(key) ?? sessionReady)
    .then(() =>
      persistTurn({
        id: turn.id,
        sessionId,
        role: turn.role,
        textJa: turn.textJa,
        textEn: turn.textEn,
        audioUri: turn.audioUri,
        referenceAudioUri: turn.referenceAudioUri,
        retryOfTurnId: turn.retryOfTurnId,
        attemptNumber: turn.attemptNumber,
        createdAt: turn.createdAt,
        streaming: turn.streaming,
        interrupted: turn.interrupted,
        pitchData: pronunciation
          ? {
              reference: pronunciation.reference,
              attempt: pronunciation.attempt,
            }
          : undefined,
        alignmentData: pronunciation
          ? {
              path: pronunciation.alignmentPath,
              units: pronunciation.units,
            }
          : undefined,
        feedback:
          turn.corrections || pronunciation
            ? {
                corrections: turn.corrections,
                pronunciation: pronunciation
                  ? {
                      version: pronunciation.version,
                      status: pronunciation.status,
                      targetText: pronunciation.targetText,
                      scores: pronunciation.scores,
                      firstCorrection: pronunciation.firstCorrection,
                      target: pronunciation.target,
                      retry: pronunciation.retry,
                    }
                  : undefined,
              }
            : undefined,
      }),
    )
    .then(() => {
      voiceEvent(
        "turn_persisted",
        {
          sessionId,
          turnId: turn.traceTurnId ?? turn.id,
          responseRunId: turn.responseRunId,
        },
        {
          persistedTurnRole: turn.role,
          streaming: Boolean(turn.streaming),
          hasAudio: Boolean(turn.audioUri),
        },
      );
    })
    .catch((error) => {
      voiceEvent(
        "turn_persistence_failed",
        {
          sessionId,
          turnId: turn.traceTurnId ?? turn.id,
          responseRunId: turn.responseRunId,
        },
        {
          errorName: errorName(error),
        },
        "error",
      );
    });
  turnPersistence.set(key, ready);
}

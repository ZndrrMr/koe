import { create } from "zustand";
import type { Register, JlptLevel } from "@/data/scenarios";
import { persistSession, persistTurn } from "@/db";
import type { PronunciationFeedback } from "@/services/pitch";
import { log } from "@/utils/log";
import {
  INITIAL_VOICE_LIFECYCLE,
  type VoiceLatency,
  type VoiceLifecycle,
  type VoicePhase,
} from "@/voice/lifecycle";

export type ConversationContext = {
  scenarioId?: string;
  topic?: string;
  registerTarget?: Register;
  jlptTarget?: JlptLevel;
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  textJa: string;
  textEn?: string;
  audioUri?: string;
  referenceAudioUri?: string;
  pronunciation?: PronunciationFeedback;
  retryOfTurnId?: string;
  attemptNumber?: number;
  corrections?: {
    particles: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
    register: { consistent: boolean; note?: string };
    other: Array<{ original: string; corrected: string; explanation: string }>;
  };
  createdAt: number;
  streaming?: boolean;
  interrupted?: boolean;
};

type SessionState = {
  id: string | null;
  context: ConversationContext;
  turns: ChatTurn[];
  isRecording: boolean;
  isStreaming: boolean;
  voice: VoiceLifecycle;
  latency: VoiceLatency;

  start: (id: string, context?: ConversationContext) => void;
  addTurn: (turn: ChatTurn) => void;
  patchTurn: (id: string, patch: Partial<ChatTurn>) => void;
  appendAssistantText: (id: string, chunk: string) => void;
  setRecording: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  setVoice: (voice: VoiceLifecycle) => void;
  setVoicePhase: (phase: VoicePhase, patch?: Partial<VoiceLifecycle>) => void;
  setInterimTranscript: (text: string) => void;
  setLatency: (latency: VoiceLatency) => void;
  end: () => void;
};

const sessionPersistence = new Map<string, Promise<void>>();
const turnPersistence = new Map<string, Promise<void>>();

export const useSession = create<SessionState>((set, get) => ({
  id: null,
  context: {},
  turns: [],
  isRecording: false,
  isStreaming: false,
  voice: INITIAL_VOICE_LIFECYCLE,
  latency: {},
  start: (id, context = {}) => {
    const ready = persistSession({
      id,
      scenarioId: context.scenarioId,
      registerTarget: context.registerTarget,
      jlptTarget: context.jlptTarget,
    }).catch((error) => {
      log.warn("Could not persist session", error);
    });
    sessionPersistence.set(id, ready);
    set({
      id,
      context,
      turns: [],
      isRecording: false,
      isStreaming: false,
      voice: INITIAL_VOICE_LIFECYCLE,
      latency: {},
    });
  },
  addTurn: (turn) => {
    set((state) => ({ turns: [...state.turns, turn] }));
    persistChatTurn(get().id, turn);
  },
  patchTurn: (id, patch) => {
    set((s) => ({
      turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    const turn = get().turns.find((candidate) => candidate.id === id);
    if (turn) persistChatTurn(get().id, turn);
  },
  appendAssistantText: (id, chunk) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === id ? { ...t, textJa: t.textJa + chunk } : t,
      ),
    })),
  setRecording: (v) => set({ isRecording: v }),
  setStreaming: (v) => set({ isStreaming: v }),
  setVoice: (voice) => set({ voice }),
  setVoicePhase: (phase, patch = {}) =>
    set((state) => ({
      voice: {
        ...state.voice,
        errorKind: undefined,
        message: undefined,
        recovery: undefined,
        ...patch,
        phase,
      },
    })),
  setInterimTranscript: (interimTranscript) =>
    set((state) => ({
      voice: {
        ...state.voice,
        phase: interimTranscript ? "interimTranscript" : "listening",
        interimTranscript,
      },
    })),
  setLatency: (latency) => set({ latency }),
  end: () =>
    set({
      id: null,
      context: {},
      turns: [],
      isRecording: false,
      isStreaming: false,
      voice: INITIAL_VOICE_LIFECYCLE,
      latency: {},
    }),
}));

function persistChatTurn(sessionId: string | null, turn: ChatTurn) {
  if (!sessionId) return;
  const pronunciation = turn.pronunciation;
  const sessionReady = sessionPersistence.get(sessionId) ?? Promise.resolve();
  const ready = (turnPersistence.get(turn.id) ?? sessionReady)
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
    .catch((error) => {
      log.warn("Could not persist turn", error);
    });
  turnPersistence.set(turn.id, ready);
}

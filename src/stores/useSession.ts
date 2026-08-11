import { create } from "zustand";
import type { Register, JlptLevel } from "@/data/scenarios";
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
  pitch?: { f0: number[]; timestamps: number[] };
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

export const useSession = create<SessionState>((set) => ({
  id: null,
  context: {},
  turns: [],
  isRecording: false,
  isStreaming: false,
  voice: INITIAL_VOICE_LIFECYCLE,
  latency: {},
  start: (id, context = {}) =>
    set({
      id,
      context,
      turns: [],
      isRecording: false,
      isStreaming: false,
      voice: INITIAL_VOICE_LIFECYCLE,
      latency: {},
    }),
  addTurn: (turn) => set((s) => ({ turns: [...s.turns, turn] })),
  patchTurn: (id, patch) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
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

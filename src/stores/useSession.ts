import { create } from 'zustand';
import type { Register, JlptLevel } from '@/data/scenarios';

export type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  textJa: string;
  textEn?: string;
  audioUri?: string;
  pitch?: { f0: number[]; timestamps: number[] };
  corrections?: {
    particles: Array<{ original: string; corrected: string; explanation: string }>;
    register: { consistent: boolean; note?: string };
    other: Array<{ original: string; corrected: string; explanation: string }>;
  };
  createdAt: number;
  streaming?: boolean;
};

type SessionState = {
  id: string | null;
  scenarioId: string | null;
  registerTarget: Register;
  jlptTarget: JlptLevel;
  turns: ChatTurn[];
  isRecording: boolean;
  isStreaming: boolean;

  start: (id: string, scenarioId: string, registerTarget: Register, jlptTarget: JlptLevel) => void;
  addTurn: (turn: ChatTurn) => void;
  patchTurn: (id: string, patch: Partial<ChatTurn>) => void;
  appendAssistantText: (id: string, chunk: string) => void;
  setRecording: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  end: () => void;
};

export const useSession = create<SessionState>((set) => ({
  id: null,
  scenarioId: null,
  registerTarget: 'teineigo',
  jlptTarget: 5,
  turns: [],
  isRecording: false,
  isStreaming: false,
  start: (id, scenarioId, registerTarget, jlptTarget) =>
    set({ id, scenarioId, registerTarget, jlptTarget, turns: [] }),
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
  end: () => set({ id: null, scenarioId: null, turns: [] }),
}));

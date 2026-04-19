import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from '@/utils/mmkv';

type ProgressState = {
  streak: number;
  lastStudyDay: string | null; // YYYY-MM-DD
  xp: number;
  xpThisWeek: number;
  weekAnchor: string | null;

  bumpXp: (by: number) => void;
  tickDay: () => void;
  reset: () => void;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekAnchor(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day;
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
}

export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      streak: 0,
      lastStudyDay: null,
      xp: 0,
      xpThisWeek: 0,
      weekAnchor: null,
      bumpXp: (by) => {
        const wa = weekAnchor();
        const wk = get().weekAnchor === wa ? get().xpThisWeek : 0;
        set((s) => ({
          xp: s.xp + by,
          xpThisWeek: wk + by,
          weekAnchor: wa,
        }));
      },
      tickDay: () => {
        const t = today();
        const prev = get().lastStudyDay;
        if (prev === t) return;
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const streak = prev === yesterday ? get().streak + 1 : 1;
        set({ streak, lastStudyDay: t });
      },
      reset: () => set({ streak: 0, lastStudyDay: null, xp: 0, xpThisWeek: 0, weekAnchor: null }),
    }),
    {
      name: 'koe-progress',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

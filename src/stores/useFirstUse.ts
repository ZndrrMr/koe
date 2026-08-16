import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { mmkvStorage } from "@/utils/mmkv";

type FirstUseState = {
  onboardingDone: boolean;
  complete: () => void;
  reset: () => void;
};

export const useFirstUse = create<FirstUseState>()(
  persist(
    (set) => ({
      onboardingDone: false,
      complete: () => set({ onboardingDone: true }),
      reset: () => set({ onboardingDone: false }),
    }),
    {
      // Preserve the existing key so shipped users keep their first-use state.
      name: "koe-voice-settings",
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      migrate: (persisted) => ({
        onboardingDone: Boolean(
          (persisted as { onboardingDone?: unknown } | undefined)
            ?.onboardingDone,
        ),
      }),
      partialize: (state) => ({ onboardingDone: state.onboardingDone }),
    },
  ),
);

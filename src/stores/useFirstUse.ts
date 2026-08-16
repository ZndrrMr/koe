import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { mmkvStorage } from "@/utils/mmkv";
import {
  createFirstUseStorage,
  FIRST_USE_STORAGE_KEY,
  migrateFirstUseState,
} from "@/stores/firstUsePersistence";

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
      name: FIRST_USE_STORAGE_KEY,
      storage: createJSONStorage(() => createFirstUseStorage(mmkvStorage)),
      // Versions 1 and 2 belonged to the removed multi-setting store.
      version: 3,
      migrate: migrateFirstUseState,
      partialize: (state) => ({ onboardingDone: state.onboardingDone }),
    },
  ),
);

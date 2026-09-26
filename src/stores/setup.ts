import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getBaseUrl } from '../lib/api';

interface SetupState {
  /**
   * true once the first-use wizard has been completed (or skipped).
   * Persisted so the wizard only appears once after a successful setup.
   */
  firstUseComplete: boolean;
  isChecking: boolean;
  /**
   * Check whether this is a fresh install with no users on the server.
   * Queries both doctors and secretaries; empty both means first use.
   */
  checkFirstUse: () => Promise<boolean>;
  markSetupComplete: () => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      firstUseComplete: false,
      isChecking: false,

      checkFirstUse: async () => {
        set({ isChecking: true });
        try {
          const base = getBaseUrl();
          const response = await fetch(`${base}/api/admin/bootstrap/status`, {
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
          });
          if (!response.ok) {
            set({ isChecking: false, firstUseComplete: true });
            return false;
          }
          const data = await response.json();
          const firstUse = data?.completed !== true;
          if (!firstUse) {
            set({ isChecking: false, firstUseComplete: true });
          } else {
            set({ isChecking: false });
          }
          return firstUse;
        } catch {
          // Server unreachable: assume not first use so the user goes to login
          // (matching the JavaFX "returning user + unreachable -> Login" branch).
          set({ isChecking: false });
          return false;
        }
      },

      markSetupComplete: () => {
        set({ firstUseComplete: true });
      },
    }),
    {
      name: 'zeyara_setup',
      partialize: (state) => ({ firstUseComplete: state.firstUseComplete }),
    }
  )
);

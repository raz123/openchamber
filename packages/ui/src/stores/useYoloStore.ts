import { create } from 'zustand';
import { opencodeClient } from '@/lib/opencode/client';

type YoloState = {
  enabled: boolean;
  loading: boolean;
  saving: boolean;
  lastError: string | null;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};

export const useYoloStore = create<YoloState>((set) => ({
  enabled: false,
  loading: false,
  saving: false,
  lastError: null,
  refresh: async () => {
    set({ loading: true, lastError: null });
    try {
      const enabled = await opencodeClient.getYoloStatus();
      set({ enabled, loading: false });
    } catch (error) {
      set({
        loading: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },
  setEnabled: async (enabled: boolean) => {
    set({ saving: true, lastError: null });
    // Optimistic update so the UI reacts immediately.
    set({ enabled });
    try {
      await opencodeClient.setYolo(enabled);
      set({ saving: false });
    } catch (error) {
      // Revert on failure.
      set({
        enabled: !enabled,
        saving: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

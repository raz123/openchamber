import { create } from 'zustand';
import { opencodeClient } from '@/lib/opencode/client';
import { runtimeFetch } from '@/lib/runtime-fetch';

// Mirror the yolo flag to the server so the notification runtime silences
// ALL trigger paths (completion, error, question, permission) at the source.
// Also persists the value in OpenChamber settings for durability.
const mirrorYoloToServer = (enabled: boolean): void => {
  void runtimeFetch('/api/notifications/yolo-suppress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).catch(() => {
    /* best-effort */
  });
};

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
      // Source of truth is the OpenChamber server (persisted in settings).
      const res = await runtimeFetch('/api/notifications/yolo-suppress');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      const enabled = data?.enabled === true;
      set({ enabled, loading: false });

      // Best-effort: sync OpenCode config to match. If the server silently
      // drops the yolo field (documented SDK gap), the toggle stays checked
      // because server-side suppression is already armed.
      if (enabled) {
        void opencodeClient.setYolo(true).catch(() => {});
      }
    } catch (error) {
      set({
        loading: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },
  setEnabled: async (enabled: boolean) => {
    set({ saving: true, lastError: null });
    // Arm suppression FIRST — before the OpenCode config round-trip — so
    // there is no race window where a notification trigger event arrives
    // between the yolo toggle and the suppression flag being set.
    set({ enabled });
    mirrorYoloToServer(enabled);
    try {
      await opencodeClient.setYolo(enabled);
      set({ saving: false });
      // If setYolo fails, do NOT revert suppression. The flag was already
      // armed via mirrorYoloToServer AND persisted to OpenChamber settings.
      // Suppressing too aggressively is safer than leaking a notification.
    } catch (error) {
      set({
        saving: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

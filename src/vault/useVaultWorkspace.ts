import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { VaultPort } from "../platform/vault";
import { VaultWorkspaceController } from "./VaultWorkspaceController";

export function useVaultWorkspace(port: VaultPort, debounceMs: number, startupRoot: string | null | undefined) {
  const controller = useMemo(
    () => new VaultWorkspaceController(port, { debounceMs }),
    [port],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );

  useEffect(() => {
    if (startupRoot === undefined) return;
    void controller.initialize(startupRoot);
    return () => { void controller.dispose(); };
  }, [controller, startupRoot]);

  useEffect(() => controller.setDebounceMs(debounceMs), [controller, debounceMs]);

  return { state, controller };
}

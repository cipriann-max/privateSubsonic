import type { Provider } from "./types.js";
import { createArchiveOrgProvider } from "./archive-org.js";

/**
 * Minimal provider selection. No plugin loader — adding a provider means
 * adding an import and a case here, deliberately.
 */

const providers: Record<string, () => Provider> = {
  "archive-org": createArchiveOrgProvider,
};

const instances = new Map<string, Provider>();

export function getProvider(id: string): Provider {
  const existing = instances.get(id);
  if (existing) {
    return existing;
  }
  const factory = providers[id];
  if (!factory) {
    throw new Error(`Unknown provider: ${id}`);
  }
  const instance = factory();
  instances.set(id, instance);
  return instance;
}
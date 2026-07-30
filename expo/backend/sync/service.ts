/**
 * Storage wiring for the sync bridge — SERVER PROCESS ONLY.
 *
 * The service-role client is created lazily from protected environment
 * variables and never leaves this module. Tests (and the cross-repo
 * process round trip) install an in-memory storage instead via
 * setSyncStorageForTesting.
 */
import { createClient } from "@supabase/supabase-js";
import { readSyncBridgeConfig } from "./config";
import { createMemorySyncStorage, createSupabaseSyncStorage, type SyncStorage } from "./storage";

let instance: SyncStorage | null = null;

export function getSyncStorage(): SyncStorage {
  if (instance) return instance;
  const config = readSyncBridgeConfig();
  if (config.enabled && config.serviceRoleKey && config.supabaseUrl) {
    instance = createSupabaseSyncStorage(
      createClient(config.supabaseUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
    );
    return instance;
  }
  // No database configuration: an in-memory store keeps the bridge honest
  // in local/dev processes (state is process-lifetime only).
  instance = createMemorySyncStorage();
  return instance;
}

export function setSyncStorageForTesting(storage: SyncStorage | null): void {
  instance = storage;
}

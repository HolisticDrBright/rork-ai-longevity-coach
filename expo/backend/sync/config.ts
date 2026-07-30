/**
 * patient-sync/1 bridge configuration — names only, values from protected
 * environment variables (Fly/Railway secrets). NONE of these are
 * EXPO_PUBLIC_*: the mobile bundle never sees them.
 *
 *   PATIENT_SYNC_ENABLED           "true" to mount the receiver at all
 *   PATIENT_SYNC_INBOUND_SECRET    HMAC secret for envelopes FROM desktop
 *   PATIENT_SYNC_INBOUND_KEY_ID    key id identifying that secret
 *   PATIENT_SYNC_OUTBOUND_URL      desktop worker callback base URL
 *   PATIENT_SYNC_OUTBOUND_SECRET   HMAC secret for callbacks TO desktop
 *   PATIENT_SYNC_OUTBOUND_KEY_ID   key id identifying that secret
 *   SYNC_SUPABASE_SERVICE_ROLE_KEY service-role key for receiver writes
 *                                  (server process ONLY)
 *
 * Enablement is ALL-OR-NOTHING and fails closed: setting
 * PATIENT_SYNC_ENABLED without the complete secret set leaves the bridge
 * disabled with a logged reason. An environment flag alone is never
 * approval — the desktop side additionally requires its reviewed provider
 * registry entry (the `alp_patient_sync` connector) before it will send
 * anything.
 */
export interface SyncBridgeConfig {
  enabled: boolean;
  disabledReason: string | null;
  inboundSecret: string;
  inboundKeyId: string;
  outboundUrl: string;
  outboundSecret: string;
  outboundKeyId: string;
  serviceRoleKey: string;
  supabaseUrl: string;
}

export function readSyncBridgeConfig(env: Record<string, string | undefined> = process.env): SyncBridgeConfig {
  const disabled = (reason: string): SyncBridgeConfig => ({
    enabled: false,
    disabledReason: reason,
    inboundSecret: "", inboundKeyId: "", outboundUrl: "",
    outboundSecret: "", outboundKeyId: "", serviceRoleKey: "", supabaseUrl: "",
  });

  if (env.PATIENT_SYNC_ENABLED !== "true") {
    return disabled("PATIENT_SYNC_ENABLED is not \"true\"");
  }
  const required = [
    "PATIENT_SYNC_INBOUND_SECRET", "PATIENT_SYNC_INBOUND_KEY_ID",
    "PATIENT_SYNC_OUTBOUND_URL", "PATIENT_SYNC_OUTBOUND_SECRET",
    "PATIENT_SYNC_OUTBOUND_KEY_ID",
  ] as const;
  for (const name of required) {
    if (!env[name]) return disabled(`${name} is not configured`);
  }
  return {
    enabled: true,
    disabledReason: null,
    inboundSecret: env.PATIENT_SYNC_INBOUND_SECRET!,
    inboundKeyId: env.PATIENT_SYNC_INBOUND_KEY_ID!,
    outboundUrl: env.PATIENT_SYNC_OUTBOUND_URL!.replace(/\/$/, ""),
    outboundSecret: env.PATIENT_SYNC_OUTBOUND_SECRET!,
    outboundKeyId: env.PATIENT_SYNC_OUTBOUND_KEY_ID!,
    serviceRoleKey: env.SYNC_SUPABASE_SERVICE_ROLE_KEY ?? "",
    supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  };
}

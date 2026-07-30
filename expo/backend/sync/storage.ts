/**
 * Storage port for the patient-sync/1 receiver.
 *
 * The receiver's logic (signatures, replay, idempotency, tombstones,
 * out-of-order handling) is written against this interface so it can be
 * proven deterministically without a database. Two implementations:
 *
 *  - createMemorySyncStorage(): in-process, used by the contract tests and
 *    by the cross-repo process round trip.
 *  - createSupabaseSyncStorage(client): maps 1:1 onto the tables added by
 *    migration `20260730230000_patient_sync_receiver.sql`, using the
 *    backend's SERVICE-ROLE client (server process only — the mobile app
 *    never holds that key and reads only through RLS/RPCs).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncConnectionRow {
  id: string;
  desktopConnectionId: string;
  desktopOrganizationId: string;
  userId: string;
  status: "active" | "revoked";
  verifiedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface SyncEnvelopeRow {
  id: string;
  connectionId: string;
  eventUid: string;
  idempotencyKey: string;
  scope: string;
  resourceType: string;
  resourceId: string;
  resourceVersion: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  provenance: Record<string, unknown>;
  correlationId: string | null;
  causationId: string | null;
  receivedAt: string;
  receiptIds: string[];
}

export interface SyncResourceRow {
  connectionId: string;
  resourceType: string;
  resourceId: string;
  resourceVersion: string;
  scope: string;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  occurredAt: string;
  updatedAt: string;
  sourceEventUid: string;
  tombstoned: boolean;
  tombstoneReason: string | null;
  acknowledgedAt: string | null;
}

export interface SyncOutboxRow {
  id: string;
  connectionId: string;
  providerEventId: string;
  resourceType: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  occurredAt: string;
  externalResourceId: string | null;
  resourceVersion: string | null;
  state: "queued" | "delivered" | "failed";
  attempts: number;
  lastErrorSafe: string | null;
}

export interface SyncHistoryRow {
  connectionId: string;
  kind: string;
  detail: string | null;
  createdAt: string;
}

export interface SyncStorage {
  getConnectionByDesktopId(desktopConnectionId: string): Promise<SyncConnectionRow | null>;
  getConnectionForUser(userId: string): Promise<SyncConnectionRow | null>;
  insertConnection(row: Omit<SyncConnectionRow, "id">): Promise<SyncConnectionRow>;
  revokeConnection(id: string, reason: string): Promise<void>;

  /** Durable replay ledger. Returns replay=true when the nonce was seen. */
  registerNonce(keyId: string, nonce: string): Promise<{ replay: boolean }>;

  getEnvelopeByEventUid(eventUid: string): Promise<SyncEnvelopeRow | null>;
  insertEnvelope(row: Omit<SyncEnvelopeRow, "id">): Promise<SyncEnvelopeRow>;

  getResource(connectionId: string, resourceType: string, resourceId: string): Promise<SyncResourceRow | null>;
  upsertResource(row: SyncResourceRow): Promise<void>;
  tombstoneResource(
    connectionId: string, resourceType: string, resourceId: string,
    reason: string, sourceEventUid: string,
  ): Promise<void>;
  listResources(connectionId: string): Promise<SyncResourceRow[]>;
  recordResourceAck(connectionId: string, resourceType: string, resourceId: string, at: string): Promise<void>;

  appendHistory(connectionId: string, kind: string, detail?: string | null): Promise<void>;
  listHistory(connectionId: string): Promise<SyncHistoryRow[]>;

  queueOutbox(row: Omit<SyncOutboxRow, "id" | "state" | "attempts" | "lastErrorSafe">): Promise<SyncOutboxRow>;
  listQueuedOutbox(limit: number): Promise<SyncOutboxRow[]>;
  markOutbox(id: string, state: "delivered" | "failed" | "queued", errorSafe?: string | null): Promise<void>;
}

let memSeq = 0;
const memId = () => `alp-mem-${String(++memSeq).padStart(6, "0")}`;

export function createMemorySyncStorage(): SyncStorage {
  const connections = new Map<string, SyncConnectionRow>();
  const nonces = new Set<string>();
  const envelopes = new Map<string, SyncEnvelopeRow>();
  const resources = new Map<string, SyncResourceRow>();
  const outbox = new Map<string, SyncOutboxRow>();
  const history: SyncHistoryRow[] = [];
  const rkey = (c: string, t: string, r: string) => `${c}:${t}:${r}`;

  return {
    async getConnectionByDesktopId(desktopConnectionId) {
      return [...connections.values()].find((c) => c.desktopConnectionId === desktopConnectionId) ?? null;
    },
    async getConnectionForUser(userId) {
      return (
        [...connections.values()].find((c) => c.userId === userId && c.status === "active")
        ?? [...connections.values()].find((c) => c.userId === userId)
        ?? null
      );
    },
    async insertConnection(row) {
      const full = { ...row, id: memId() };
      connections.set(full.id, full);
      return full;
    },
    async revokeConnection(id, reason) {
      const c = connections.get(id);
      if (c) {
        c.status = "revoked";
        c.revokedAt = new Date().toISOString();
        c.revokeReason = reason;
      }
    },
    async registerNonce(keyId, nonce) {
      const key = `${keyId}:${nonce}`;
      if (nonces.has(key)) return { replay: true };
      nonces.add(key);
      return { replay: false };
    },
    async getEnvelopeByEventUid(eventUid) {
      return [...envelopes.values()].find((e) => e.eventUid === eventUid) ?? null;
    },
    async insertEnvelope(row) {
      const full = { ...row, id: memId() };
      envelopes.set(full.id, full);
      return full;
    },
    async getResource(connectionId, resourceType, resourceId) {
      return resources.get(rkey(connectionId, resourceType, resourceId)) ?? null;
    },
    async upsertResource(row) {
      resources.set(rkey(row.connectionId, row.resourceType, row.resourceId), { ...row });
    },
    async tombstoneResource(connectionId, resourceType, resourceId, reason, sourceEventUid) {
      const key = rkey(connectionId, resourceType, resourceId);
      const existing = resources.get(key);
      const now = new Date().toISOString();
      resources.set(key, {
        connectionId, resourceType, resourceId,
        resourceVersion: existing?.resourceVersion ?? "withdrawn",
        scope: existing?.scope ?? "programs",
        payload: {},
        provenance: existing?.provenance ?? {},
        occurredAt: existing?.occurredAt ?? now,
        updatedAt: now,
        sourceEventUid,
        tombstoned: true,
        tombstoneReason: reason,
        acknowledgedAt: existing?.acknowledgedAt ?? null,
      });
    },
    async listResources(connectionId) {
      return [...resources.values()]
        .filter((r) => r.connectionId === connectionId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async recordResourceAck(connectionId, resourceType, resourceId, at) {
      const r = resources.get(rkey(connectionId, resourceType, resourceId));
      if (r) r.acknowledgedAt = at;
    },
    async appendHistory(connectionId, kind, detail) {
      history.push({ connectionId, kind, detail: detail ?? null, createdAt: new Date().toISOString() });
    },
    async listHistory(connectionId) {
      return history.filter((h) => h.connectionId === connectionId);
    },
    async queueOutbox(row) {
      const full: SyncOutboxRow = { ...row, id: memId(), state: "queued", attempts: 0, lastErrorSafe: null };
      outbox.set(full.id, full);
      return full;
    },
    async listQueuedOutbox(limit) {
      return [...outbox.values()].filter((o) => o.state === "queued").slice(0, limit);
    },
    async markOutbox(id, state, errorSafe) {
      const o = outbox.get(id);
      if (o) {
        o.state = state;
        o.attempts += 1;
        o.lastErrorSafe = errorSafe ?? null;
      }
    },
  };
}

/** Maps the port onto the Supabase tables (service-role client, server only). */
export function createSupabaseSyncStorage(client: SupabaseClient): SyncStorage {
  const mapConnection = (row: Record<string, unknown>): SyncConnectionRow => ({
    id: row.id as string,
    desktopConnectionId: row.desktop_connection_id as string,
    desktopOrganizationId: row.desktop_organization_id as string,
    userId: row.user_id as string,
    status: row.status as SyncConnectionRow["status"],
    verifiedAt: row.verified_at as string,
    revokedAt: (row.revoked_at as string | null) ?? null,
    revokeReason: (row.revoke_reason as string | null) ?? null,
  });
  const mapResource = (row: Record<string, unknown>): SyncResourceRow => ({
    connectionId: row.connection_id as string,
    resourceType: row.resource_type as string,
    resourceId: row.resource_id as string,
    resourceVersion: row.resource_version as string,
    scope: row.scope as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    provenance: (row.provenance as Record<string, unknown>) ?? {},
    occurredAt: row.occurred_at as string,
    updatedAt: row.updated_at as string,
    sourceEventUid: row.source_event_uid as string,
    tombstoned: row.tombstoned as boolean,
    tombstoneReason: (row.tombstone_reason as string | null) ?? null,
    acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
  });

  return {
    async getConnectionByDesktopId(desktopConnectionId) {
      const { data } = await client.from("patient_sync_connections")
        .select("*").eq("desktop_connection_id", desktopConnectionId).single();
      return data ? mapConnection(data) : null;
    },
    async getConnectionForUser(userId) {
      const { data } = await client.from("patient_sync_connections")
        .select("*").eq("user_id", userId)
        .order("verified_at", { ascending: false }).limit(1);
      const rows = (data ?? []) as Record<string, unknown>[];
      const active = rows.find((r) => r.status === "active") ?? rows[0];
      return active ? mapConnection(active) : null;
    },
    async insertConnection(row) {
      const { data, error } = await client.from("patient_sync_connections").insert({
        desktop_connection_id: row.desktopConnectionId,
        desktop_organization_id: row.desktopOrganizationId,
        user_id: row.userId,
        status: row.status,
        verified_at: row.verifiedAt,
      }).select("*").single();
      if (error || !data) throw new Error(`sync connection insert failed: ${error?.code ?? "unknown"}`);
      return mapConnection(data);
    },
    async revokeConnection(id, reason) {
      await client.from("patient_sync_connections")
        .update({ status: "revoked", revoked_at: new Date().toISOString(), revoke_reason: reason })
        .eq("id", id);
    },
    async registerNonce(keyId, nonce) {
      const { error } = await client.from("patient_sync_nonces")
        .insert({ key_id: keyId, nonce });
      if (error && error.code === "23505") return { replay: true };
      if (error) throw new Error(`nonce registration failed: ${error.code}`);
      return { replay: false };
    },
    async getEnvelopeByEventUid(eventUid) {
      const { data } = await client.from("patient_sync_envelopes")
        .select("*").eq("event_uid", eventUid).single();
      if (!data) return null;
      return {
        id: data.id as string,
        connectionId: data.connection_id as string,
        eventUid: data.event_uid as string,
        idempotencyKey: data.idempotency_key as string,
        scope: data.scope as string,
        resourceType: data.resource_type as string,
        resourceId: data.resource_id as string,
        resourceVersion: data.resource_version as string,
        occurredAt: data.occurred_at as string,
        payload: (data.payload as Record<string, unknown>) ?? {},
        payloadHash: data.payload_hash as string,
        provenance: (data.provenance as Record<string, unknown>) ?? {},
        correlationId: (data.correlation_id as string | null) ?? null,
        causationId: (data.causation_id as string | null) ?? null,
        receivedAt: data.received_at as string,
        receiptIds: (data.receipt_ids as string[]) ?? [],
      };
    },
    async insertEnvelope(row) {
      const { data, error } = await client.from("patient_sync_envelopes").insert({
        connection_id: row.connectionId,
        event_uid: row.eventUid,
        idempotency_key: row.idempotencyKey,
        scope: row.scope,
        resource_type: row.resourceType,
        resource_id: row.resourceId,
        resource_version: row.resourceVersion,
        occurred_at: row.occurredAt,
        payload: row.payload,
        payload_hash: row.payloadHash,
        provenance: row.provenance,
        correlation_id: row.correlationId,
        causation_id: row.causationId,
        received_at: row.receivedAt,
        receipt_ids: row.receiptIds,
      }).select("id").single();
      if (error || !data) throw new Error(`envelope insert failed: ${error?.code ?? "unknown"}`);
      return { ...row, id: data.id as string };
    },
    async getResource(connectionId, resourceType, resourceId) {
      const { data } = await client.from("patient_sync_resources").select("*")
        .eq("connection_id", connectionId)
        .eq("resource_type", resourceType)
        .eq("resource_id", resourceId)
        .single();
      return data ? mapResource(data) : null;
    },
    async upsertResource(row) {
      const { error } = await client.from("patient_sync_resources").upsert({
        connection_id: row.connectionId,
        resource_type: row.resourceType,
        resource_id: row.resourceId,
        resource_version: row.resourceVersion,
        scope: row.scope,
        payload: row.payload,
        provenance: row.provenance,
        occurred_at: row.occurredAt,
        updated_at: row.updatedAt,
        source_event_uid: row.sourceEventUid,
        tombstoned: row.tombstoned,
        tombstone_reason: row.tombstoneReason,
        acknowledged_at: row.acknowledgedAt,
      }, { onConflict: "connection_id,resource_type,resource_id" });
      if (error) throw new Error(`resource upsert failed: ${error.code}`);
    },
    async tombstoneResource(connectionId, resourceType, resourceId, reason, sourceEventUid) {
      const now = new Date().toISOString();
      const { error } = await client.from("patient_sync_resources").upsert({
        connection_id: connectionId,
        resource_type: resourceType,
        resource_id: resourceId,
        resource_version: "withdrawn",
        scope: "programs",
        payload: {},
        provenance: {},
        occurred_at: now,
        updated_at: now,
        source_event_uid: sourceEventUid,
        tombstoned: true,
        tombstone_reason: reason,
      }, { onConflict: "connection_id,resource_type,resource_id" });
      if (error) throw new Error(`tombstone failed: ${error.code}`);
    },
    async listResources(connectionId) {
      const { data } = await client.from("patient_sync_resources").select("*")
        .eq("connection_id", connectionId)
        .order("updated_at", { ascending: false });
      return ((data ?? []) as Record<string, unknown>[]).map(mapResource);
    },
    async recordResourceAck(connectionId, resourceType, resourceId, at) {
      await client.from("patient_sync_resources")
        .update({ acknowledged_at: at })
        .eq("connection_id", connectionId)
        .eq("resource_type", resourceType)
        .eq("resource_id", resourceId);
    },
    async appendHistory(connectionId, kind, detail) {
      await client.from("patient_sync_events")
        .insert({ connection_id: connectionId, kind, detail: detail ?? null });
    },
    async listHistory(connectionId) {
      const { data } = await client.from("patient_sync_events").select("*")
        .eq("connection_id", connectionId).order("created_at", { ascending: true });
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        connectionId: row.connection_id as string,
        kind: row.kind as string,
        detail: (row.detail as string | null) ?? null,
        createdAt: row.created_at as string,
      }));
    },
    async queueOutbox(row) {
      const { data, error } = await client.from("patient_sync_outbox").insert({
        connection_id: row.connectionId,
        provider_event_id: row.providerEventId,
        resource_type: row.resourceType,
        payload: row.payload,
        payload_hash: row.payloadHash,
        occurred_at: row.occurredAt,
        external_resource_id: row.externalResourceId,
        resource_version: row.resourceVersion,
        state: "queued",
      }).select("id").single();
      if (error || !data) throw new Error(`outbox insert failed: ${error?.code ?? "unknown"}`);
      return { ...row, id: data.id as string, state: "queued", attempts: 0, lastErrorSafe: null };
    },
    async listQueuedOutbox(limit) {
      const { data } = await client.from("patient_sync_outbox").select("*")
        .eq("state", "queued").order("occurred_at", { ascending: true }).limit(limit);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        connectionId: row.connection_id as string,
        providerEventId: row.provider_event_id as string,
        resourceType: row.resource_type as string,
        payload: (row.payload as Record<string, unknown>) ?? {},
        payloadHash: row.payload_hash as string,
        occurredAt: row.occurred_at as string,
        externalResourceId: (row.external_resource_id as string | null) ?? null,
        resourceVersion: (row.resource_version as string | null) ?? null,
        state: row.state as SyncOutboxRow["state"],
        attempts: (row.attempts as number) ?? 0,
        lastErrorSafe: (row.last_error_safe as string | null) ?? null,
      }));
    },
    async markOutbox(id, state, errorSafe) {
      await client.from("patient_sync_outbox")
        .update({ state, last_error_safe: errorSafe ?? null })
        .eq("id", id);
    },
  };
}

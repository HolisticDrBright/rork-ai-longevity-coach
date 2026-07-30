/**
 * Patient-facing desktop-sync procedures (all protectedProcedure — the
 * patient's own Supabase session).
 *
 * Linking uses ONLY the explicit one-time invitation code from the Phase 5
 * exchange: the code is presented to the desktop's signed /sync/verify
 * boundary together with this user's opaque auth id as the external
 * subject. Never email, name, phone, date of birth, or fuzzy matching.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../../create-context";
import { readSyncBridgeConfig } from "../../../sync/config";
import { getSyncStorage } from "../../../sync/service";
import { queueAckEvidence, queueInboundEvent, postSignedCallback, dispatchOutboxOnce } from "../../../sync/outbound";

const INBOUND_PATIENT_TYPES = [
  "protocol_adherence", "supplement_adherence", "checkin_response",
  "symptom_report", "outcome_report",
] as const;

function requireBridge() {
  const config = readSyncBridgeConfig();
  if (!config.enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Desktop sync is not configured on this server.",
    });
  }
  return config;
}

export const syncRouter = createTRPCRouter({
  /** Connection status + honest disabled state. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const config = readSyncBridgeConfig();
    if (!config.enabled) {
      return { configured: false as const, connection: null, resources: [], history: [] };
    }
    const storage = getSyncStorage();
    const connection = await storage.getConnectionForUser(ctx.user.id);
    if (!connection) {
      return { configured: true as const, connection: null, resources: [], history: [] };
    }
    const resources = await storage.listResources(connection.id);
    const history = await storage.listHistory(connection.id);
    return {
      configured: true as const,
      connection: {
        id: connection.id,
        status: connection.status,
        verifiedAt: connection.verifiedAt,
        revokedAt: connection.revokedAt,
      },
      resources: resources.map((r) => ({
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        resourceVersion: r.resourceVersion,
        scope: r.scope,
        payload: r.tombstoned ? {} : r.payload,
        provenance: r.provenance,
        occurredAt: r.occurredAt,
        updatedAt: r.updatedAt,
        tombstoned: r.tombstoned,
        tombstoneReason: r.tombstoneReason,
        acknowledgedAt: r.acknowledgedAt,
      })),
      history: history.map((h) => ({ kind: h.kind, detail: h.detail, createdAt: h.createdAt })),
    };
  }),

  /** Present the one-time code to the desktop and bind this account. */
  link: protectedProcedure
    .input(z.object({ code: z.string().regex(/^[0-9a-f]{64}$/) }))
    .mutation(async ({ ctx, input }) => {
      const config = requireBridge();
      const storage = getSyncStorage();
      const existing = await storage.getConnectionForUser(ctx.user.id);
      if (existing && existing.status === "active") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This account is already connected. Disconnect first to re-link.",
        });
      }
      const result = await postSignedCallback({
        config: { url: config.outboundUrl, secret: config.outboundSecret, keyId: config.outboundKeyId },
        body: { token: input.code, subject: ctx.user.id },
        // The verify boundary lives beside /sync/callback on the desktop
        // worker; postSignedCallback appends /sync/callback, so override:
        fetchImpl: (url, init) =>
          fetch(String(url).replace(/\/sync\/callback$/, "/sync/verify"), init),
      });
      if (result.status !== 200) {
        const code = (result.body as { error?: { code?: string } } | null)?.error?.code;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            code === "invitation_expired" ? "This code has expired. Ask your practitioner for a new one."
            : code === "invitation_used" ? "This code was already used. Ask your practitioner for a new one."
            : "The code could not be verified. Check it and try again.",
        });
      }
      const verified = result.body as {
        connectionId: string; organizationId: string; contractVersion: string;
      };
      const row = await storage.insertConnection({
        desktopConnectionId: verified.connectionId,
        desktopOrganizationId: verified.organizationId,
        userId: ctx.user.id,
        status: "active",
        verifiedAt: new Date().toISOString(),
        revokedAt: null,
        revokeReason: null,
      });
      await storage.appendHistory(row.id, "connection_activated");
      return { ok: true, connectionId: row.id };
    }),

  /** Patient acknowledgment of a shared resource — evidence to the desktop. */
  acknowledgeResource: protectedProcedure
    .input(z.object({ resourceType: z.string().min(1), resourceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireBridge();
      const storage = getSyncStorage();
      const connection = await storage.getConnectionForUser(ctx.user.id);
      if (!connection || connection.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active desktop connection." });
      }
      const resource = await storage.getResource(connection.id, input.resourceType, input.resourceId);
      if (!resource || resource.tombstoned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That shared resource is not available." });
      }
      const at = new Date().toISOString();
      await storage.recordResourceAck(connection.id, input.resourceType, input.resourceId, at);
      await queueAckEvidence({ storage, connectionId: connection.id, eventUid: resource.sourceEventUid });
      await storage.appendHistory(connection.id, "resource_acknowledged", input.resourceType);
      return { ok: true, acknowledgedAt: at };
    }),

  /** Patient-generated events (adherence, check-ins, symptoms, outcomes). */
  submitEvent: protectedProcedure
    .input(z.object({
      resourceType: z.enum(INBOUND_PATIENT_TYPES),
      payload: z.record(z.string(), z.unknown()),
      externalResourceId: z.string().min(1).max(120).optional(),
      resourceVersion: z.string().min(1).max(40).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireBridge();
      const storage = getSyncStorage();
      const connection = await storage.getConnectionForUser(ctx.user.id);
      if (!connection || connection.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active desktop connection." });
      }
      const payloadText = JSON.stringify(input.payload);
      if (Buffer.byteLength(payloadText, "utf8") > 16384) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Submission is too large." });
      }
      const row = await queueInboundEvent({
        storage,
        connectionId: connection.id,
        desktopConnectionId: connection.desktopConnectionId,
        resourceType: input.resourceType,
        payload: input.payload,
        externalResourceId: input.externalResourceId ?? null,
        resourceVersion: input.resourceVersion ?? null,
      });
      await storage.appendHistory(connection.id, "patient_event_queued", input.resourceType);
      return { ok: true, queuedEventId: row.id };
    }),

  /** Revoke the connection from the patient side — effective immediately. */
  revoke: protectedProcedure
    .input(z.object({ reason: z.string().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      requireBridge();
      const storage = getSyncStorage();
      const connection = await storage.getConnectionForUser(ctx.user.id);
      if (!connection || connection.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active desktop connection." });
      }
      await storage.revokeConnection(connection.id, input.reason);
      // Tell the desktop: consent_change events per revoked direction are
      // queued durably; future desktop deliveries are refused 403 regardless.
      await queueInboundEvent({
        storage,
        connectionId: connection.id,
        desktopConnectionId: connection.desktopConnectionId,
        resourceType: "consent_change",
        payload: { action: "revoke_connection", reason: input.reason },
      });
      await storage.appendHistory(connection.id, "connection_revoked_by_patient");
      return { ok: true };
    }),

  /** One outbox dispatch pass (patient-triggered "sync now"). */
  dispatchOutbox: protectedProcedure.mutation(async ({ ctx }) => {
    const config = requireBridge();
    const storage = getSyncStorage();
    const connection = await storage.getConnectionForUser(ctx.user.id);
    if (!connection) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No desktop connection." });
    }
    const result = await dispatchOutboxOnce({
      storage,
      config: { url: config.outboundUrl, secret: config.outboundSecret, keyId: config.outboundKeyId },
      desktopConnectionIdFor: async (id) =>
        id === connection.id ? connection.desktopConnectionId : null,
    });
    return { ok: true, ...result };
  }),
});

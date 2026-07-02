import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
    JunctionClient,
    JunctionEnvironment,
    Junction,
} from "@junction-api/sdk";

import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import { createServerSupabaseClient, createServiceSupabaseClient } from "../../supabase-server";

const junctionClient = new JunctionClient({
    apiKey: process.env.EXPO_PUBLIC_VITAL_API_KEY,
    environment: JunctionEnvironment.Sandbox,
});

export const junctionRouter = createTRPCRouter({

    /**
     * Get or create a Junction user tied to the authenticated Supabase user.
     * Stores the returned Junction userId in profiles.junction_user_id so it
     * is reused on every subsequent call — one Junction user per app user.
     */
    getOrCreateUser: protectedProcedure
        .mutation(async ({ ctx }) => {
            const supabase = createServerSupabaseClient(ctx.sessionToken);
            const adminSupabase = createServiceSupabaseClient();

            // Check if a Junction user already exists for this account
            const { data: profile } = await supabase
                .from('profiles')
                .select('junction_user_id')
                .eq('id', ctx.user.id)
                .single();

            if (profile?.junction_user_id) {
                return { junctionUserId: profile.junction_user_id };
            }

            // Create the Junction user — if one already exists for this clientUserId
            // (e.g. created before we started persisting), fall back to a lookup.
            let junctionUserId: string;
            try {
                const created = await junctionClient.user.create({
                    clientUserId: ctx.user.id,
                });
                junctionUserId = created.userId;
            } catch {
                // Duplicate clientUserId — fetch the existing Junction user instead
                try {
                    const existing = await junctionClient.user.getByClientUserId({
                        clientUserId: ctx.user.id,
                    });
                    junctionUserId = existing.userId;
                } catch (lookupErr) {
                    console.error('Junction: could not create or find user', lookupErr);
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Failed to create or retrieve Junction user.',
                    });
                }
            }

            // Use service role to bypass RLS on the profiles write
            const { error: updateError } = await adminSupabase
                .from('profiles')
                .update({ junction_user_id: junctionUserId })
                .eq('id', ctx.user.id);

            if (updateError) {
                console.error('Failed to store junction_user_id:', updateError);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to save Junction user ID to profile.',
                });
            }

            return { junctionUserId };
        }),

    /**
     * Create a one-time Junction Link token for the given provider.
     * Reads junction_user_id from the profile — caller must have run
     * getOrCreateUser first (or it will throw).
     */
    createLinkToken: protectedProcedure
        .input(
            z.object({
                provider: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const supabase = createServerSupabaseClient(ctx.sessionToken);
            const adminSupabase = createServiceSupabaseClient();

            const { data: profile } = await supabase
                .from('profiles')
                .select('junction_user_id')
                .eq('id', ctx.user.id)
                .single();

            // Auto-create the Junction user if it wasn't stored yet
            let junctionUserId = profile?.junction_user_id ?? null;
            if (!junctionUserId) {
                try {
                    const created = await junctionClient.user.create({ clientUserId: ctx.user.id });
                    junctionUserId = created.userId;
                } catch {
                    const existing = await junctionClient.user.getByClientUserId({ clientUserId: ctx.user.id });
                    junctionUserId = existing.userId;
                }
                // Use service role to bypass RLS on the profiles write
                await adminSupabase
                    .from('profiles')
                    .update({ junction_user_id: junctionUserId })
                    .eq('id', ctx.user.id);
            }

            const response = await junctionClient.link.token({
                userId: junctionUserId,
                provider: input.provider as Junction.Providers,
            });
            return response;
        }),

    getAllProviders: publicProcedure.query(async () => {
        try {
            const providers = await junctionClient.providers.getAll();
            return providers;
        } catch (error) {
            console.error("Get Providers Error:", error);
            throw error;
        }
    }),
});

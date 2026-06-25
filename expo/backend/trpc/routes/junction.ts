import { z } from "zod";
import {
    JunctionClient,
    JunctionEnvironment,
} from "@junction-api/sdk";

import { createTRPCRouter, publicProcedure } from "../create-context";

const junctionClient = new JunctionClient({
    apiKey: process.env.EXPO_PUBLIC_VITAL_API_KEY,
    environment: JunctionEnvironment.Sandbox,
});


export const junctionRouter = createTRPCRouter({

    createUser: publicProcedure
        .input(
            z.object({
                clientUserId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const user = await junctionClient.user.create({
                clientUserId: input.clientUserId,
            });

            return user;
        }),

    createLinkToken: publicProcedure
        .input(
            z.object({
                userId: z.string(),
                provider: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            try {
                console.log("JUNCTION_API_KEY:", process.env.JUNCTION_API_KEY);
                console.log("ENV:", JunctionEnvironment.Sandbox);
                console.log("Creating token", input);

                const response = await junctionClient.link.token({
                    userId: input.userId,
                    provider: input.provider,
                });

                console.log("Junction response", response);

                return response;
            } catch (error) {
                console.error("Junction Error:", error);
                throw error;
            }
        }),



    getAllProviders: publicProcedure.query(async () => {
        try {
            const providers = await junctionClient.providers.getAll();

            console.log("Providers:", providers);

            return providers;
        } catch (error) {
            console.error("Get Providers Error:", error);
            throw error;
        }
    }),
});
import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";

import type { AppRouter } from "@/backend/trpc/app-router";
import { appConfig } from "@/lib/config";
import { supabase } from "@/lib/supabase";

export const trpc = createTRPCReact<AppRouter>();

const getBaseUrl = () => {
  const url = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || appConfig.apiBaseUrl;

  if (!url) {
    throw new Error("API base URL not configured");
  }

  return url;
};

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
      async headers() {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data?.session?.access_token;
          if (token) {
            return {
              Authorization: `Bearer ${token}`,
            };
          }
        } catch {
          console.log('[tRPC] Failed to get auth session for headers');
        }
        return {};
      },
    }),
  ],
});

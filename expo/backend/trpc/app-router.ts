import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { clinicalRouter } from "./routes/clinical";

export const appRouter = createTRPCRouter({
  // Legacy-pool namespaces (mobile app; legacy Supabase project) — unchanged.
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  // Clinical-pool namespace (dedicated project; desktop app). See ADR 0002.
  clinical: clinicalRouter,
});

export type AppRouter = typeof appRouter;

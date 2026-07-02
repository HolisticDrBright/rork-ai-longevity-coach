import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { aiRouter, integrationsRouter } from "./routes/ai";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  ai: aiRouter,
  integrations: integrationsRouter,
});

export type AppRouter = typeof appRouter;

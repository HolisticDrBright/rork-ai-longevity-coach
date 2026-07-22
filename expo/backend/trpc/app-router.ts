import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
});

export type AppRouter = typeof appRouter;

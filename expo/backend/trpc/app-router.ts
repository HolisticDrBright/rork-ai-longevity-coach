import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { reasoningRouter } from "./routes/reasoning";
import { twinRouter } from "./routes/twin";
import { labIngestionRouter } from "./routes/labs";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  reasoning: reasoningRouter,
  twin: twinRouter,
  labs: labIngestionRouter,
});

export type AppRouter = typeof appRouter;

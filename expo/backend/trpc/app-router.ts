import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { peptideRouter } from "./routes/peptide";
import { longevityRouter } from "./routes/longevity";
import { patternsRouter } from "./routes/patterns";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  peptide: peptideRouter,
  longevity: longevityRouter,
  patterns: patternsRouter,
});

export type AppRouter = typeof appRouter;

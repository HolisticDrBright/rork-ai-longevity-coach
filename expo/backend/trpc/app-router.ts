import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { peptideRouter } from "./routes/peptide";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  peptide: peptideRouter,
});

export type AppRouter = typeof appRouter;

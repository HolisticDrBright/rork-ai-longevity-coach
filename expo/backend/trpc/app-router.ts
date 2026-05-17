import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { visualDiagnosticsRouter } from "./routes/visual-diagnostics";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  visualDiagnostics: visualDiagnosticsRouter,
});

export type AppRouter = typeof appRouter;

import { createTRPCRouter } from "./create-context";
import { nutritionRouter } from "./routes/nutrition";
import { clinicRouter } from "./routes/clinic";
import { supplementsRouter } from "./routes/supplements";
import { longevityScoreRouter } from "./routes/longevityScore";
import { healthScoreRouter } from "./routes/healthScore";
import { doctorReportRouter } from "./routes/doctorReport";
import { clinicalPatternsRouter } from "./routes/clinicalPatterns";
import { userServicesRouter } from "./routes/userServices";
import { oxidativeStressRouter } from "./routes/oxidativeStress";

export const appRouter = createTRPCRouter({
  nutrition: nutritionRouter,
  clinic: clinicRouter,
  supplements: supplementsRouter,
  longevityScore: longevityScoreRouter,
  healthScore: healthScoreRouter,
  doctorReport: doctorReportRouter,
  clinicalPatterns: clinicalPatternsRouter,
  userServices: userServicesRouter,
  oxidativeStress: oxidativeStressRouter,
});

export type AppRouter = typeof appRouter;

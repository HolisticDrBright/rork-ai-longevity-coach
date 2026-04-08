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
import { oatProtocolRouter } from "./routes/oatProtocol";
import { clinicalProtocolsRouter } from "./routes/clinicalProtocols";
import { productCatalogRouter } from "./routes/productCatalog";
import { vaccineInjuryRouter } from "./routes/vaccineInjury";

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
  oatProtocol: oatProtocolRouter,
  clinicalProtocols: clinicalProtocolsRouter,
  productCatalog: productCatalogRouter,
  vaccineInjury: vaccineInjuryRouter,
});

export type AppRouter = typeof appRouter;

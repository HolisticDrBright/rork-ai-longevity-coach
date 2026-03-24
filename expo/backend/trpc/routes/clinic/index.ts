import { createTRPCRouter } from "../../create-context";
import { patientsRouter } from "./patients";
import { labsRouter } from "./labs";
import { biometricsRouter } from "./biometrics";
import { alertsRouter } from "./alerts";
import { dashboardRouter } from "./dashboard";

export const clinicRouter = createTRPCRouter({
  patients: patientsRouter,
  labs: labsRouter,
  biometrics: biometricsRouter,
  alerts: alertsRouter,
  dashboard: dashboardRouter,
});

export * from "./patients";
export * from "./labs";
export * from "./biometrics";
export * from "./alerts";
export * from "./dashboard";

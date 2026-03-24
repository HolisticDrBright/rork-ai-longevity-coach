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

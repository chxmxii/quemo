import { createToolWorker } from "@quemo/core";
import { buildServer, type Env } from "./server";

export default createToolWorker<Env>({
  id: "health",
  build: buildServer,
  userTables: ["doses", "medications", "vitals", "symptoms", "appointments", "health_profile"],
});

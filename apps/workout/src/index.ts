import { createToolWorker } from "@quemo/core";
import { buildServer, type Env } from "./server";

export default createToolWorker<Env>({
  id: "workout",
  build: buildServer,
  userTables: ["workout_sets", "workouts", "routine_exercises", "routines", "body_metrics", "goals", "exercises"],
});

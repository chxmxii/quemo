import { createToolWorker } from "@quemo/core";
import { buildServer, type Env } from "./server";

export default createToolWorker<Env>({
  id: "food",
  build: buildServer,
  userTables: ["meal_items", "meals", "foods", "water_logs", "nutrition_goals", "weights"],
});

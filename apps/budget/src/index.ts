import { createToolWorker } from "@quemo/core";
import { buildServer, type Env } from "./server";

export default createToolWorker<Env>({
  id: "budget",
  build: buildServer,
  userTables: ["transactions", "budgets", "recurring", "savings_goals", "categories", "accounts"],
});

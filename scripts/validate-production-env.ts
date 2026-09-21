import "dotenv/config";
import { validateProductionEnv } from "../apps/web/src/lib/env";

const errors = validateProductionEnv({ ...process.env, NODE_ENV: "production" });

if (errors.length) {
  console.error("Proofwork production environment validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Proofwork production environment is valid.");
}

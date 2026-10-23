import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Orbital does not configure a database by default. Configure a real `DB` binding in the Cloudflare Worker configuration before using this optional module."
    );
  }

  return drizzle(env.DB, { schema });
}

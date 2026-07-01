import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "~/db/schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

export const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });

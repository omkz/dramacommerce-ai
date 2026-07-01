import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
});

try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}

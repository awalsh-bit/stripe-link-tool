import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getPostgresPool } from "../lib/data-postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, "..", "sql", "001_initial_schema.sql");

async function main() {
  const sql = await fs.readFile(schemaPath, "utf8");
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(sql);
    console.log("Postgres schema applied successfully.");
  } catch (err) {
    console.error(err.message || "Unable to apply Postgres schema.");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || "Unexpected schema failure.");
  process.exit(1);
});

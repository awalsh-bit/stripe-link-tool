import "dotenv/config";
import { readLinks } from "../lib/data-json.js";
import {
  getPostgresPool,
  mapLinkRecordToParams,
  PAYMENT_LINK_UPSERT_SQL,
  STORAGE_TABLE
} from "../lib/data-postgres.js";

async function assertTableExists(client) {
  const result = await client.query(
    "SELECT to_regclass($1) AS table_name",
    [`public.${STORAGE_TABLE}`]
  );

  if (!result.rows[0]?.table_name) {
    throw new Error(
      `Table ${STORAGE_TABLE} does not exist yet. Run sql/001_initial_schema.sql before running this migration.`
    );
  }
}

async function main() {
  const jsonLinks = await readLinks();
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await assertTableExists(client);
    await client.query("BEGIN");

    let migratedCount = 0;

    for (const record of jsonLinks) {
      await client.query(PAYMENT_LINK_UPSERT_SQL, mapLinkRecordToParams(record));
      migratedCount += 1;
    }

    await client.query("COMMIT");

    console.log(`Migrated ${migratedCount} link records into ${STORAGE_TABLE}.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err.message || "Link migration failed.");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || "Unexpected migration failure.");
  process.exit(1);
});

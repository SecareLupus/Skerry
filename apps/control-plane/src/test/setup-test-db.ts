import pg from "pg";

async function setup() {
  const { Client } = pg;

  // We want to connect to the 'postgres' database to create our test database
  // We use the environment variables if available, otherwise defaults
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD || "postgres";
  const host = "localhost"; // Local tests run on host
  const port = 5432;

  const client = new Client({
    user,
    password,
    host,
    port,
    database: "postgres", // Connect to system DB
  });

  try {
    await client.connect();
    console.log("Connected to postgres database...");

    const dbName = "skerry_test";
    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`
    );

    if (res.rowCount === 0) {
      console.log(`Creating database ${dbName}...`);
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database ${dbName} created successfully.`);
    } else {
      console.log(`Database ${dbName} already exists.`);
    }
  } catch (err) {
    console.error("Error setting up test database:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setup();

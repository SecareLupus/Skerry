import "./load-env.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startDiscordBot } from "./services/discord-bot-client.js";
import { initDb } from "./db/client.js";

import { ensureAppserviceRegistration } from "./matrix/synapse-bootstrap.js";
import { startTimeoutWorker } from "./workers/timeout-worker.js";

async function start() {
  // Ensure Appservice registration is in sync with environment
  await ensureAppserviceRegistration();

  // Ensure DB schema is initialized
  await initDb();

  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`Control plane running at http://localhost:${config.port}`);

    // Start Discord bot client
    await startDiscordBot();

    // Start background background worker for timeouts
    startTimeoutWorker();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

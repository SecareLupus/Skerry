import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * Ensures the Matrix Appservice registration file is present and up-to-date
 * with the tokens configured in the environment.
 */
export async function ensureAppserviceRegistration() {
  if (!config.synapse.asToken || !config.synapse.hsToken) {
    console.warn("SYNAPSE_AS_TOKEN or SYNAPSE_HS_TOKEN missing. Skipping Appservice bootstrap.");
    return;
  }

  const registrationPath = config.synapse.asRegistrationPath 
    ? path.resolve(config.synapse.asRegistrationPath)
    : path.resolve(process.cwd(), "../../docker/synapse/skerry-appservice.yaml");
  
  console.log(`Ensuring Appservice registration at: ${registrationPath}`);
  console.log(`Current working directory: ${process.cwd()}`);
  
  const registrationYaml = `id: Skerry
url: http://control-plane:4000
as_token: ${config.synapse.asToken}
hs_token: ${config.synapse.hsToken}
sender_localpart: skerry-bot
namespaces:
  users:
    - exclusive: false
      regex: "@.*"
  rooms: []
  aliases: []
`;

  try {
    // Check if we need to update
    let existing = "";
    try {
      existing = await fs.readFile(registrationPath, "utf-8");
    } catch {
      // Ignore read errors (file missing)
    }

    if (existing !== registrationYaml) {
      console.log(`Updating Synapse Appservice registration at ${registrationPath}`);
      await fs.mkdir(path.dirname(registrationPath), { recursive: true });
      await fs.writeFile(registrationPath, registrationYaml, "utf-8");
      
      // In a production environment, we might notify someone to restart Synapse.
      // In dev, the user usually notices or Synapse picks it up on next boot.
      console.log("Appservice registration updated. If Synapse is already running, it must be restarted.");
    }
  } catch (error) {
    console.error(`Failed to ensure Appservice registration: ${error}`);
  }
}

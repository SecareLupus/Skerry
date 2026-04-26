/**
 * Preloaded into every test process via `tsx --import ./src/test/setup.ts`.
 *
 * Centralizes test-environment side effects that previously had to be
 * remembered at the top of every test file. Keeping them here removes a
 * load-order fragility — any new test file picks up the same baseline
 * without needing to remember to opt in.
 */
import { config } from "../config.js";

// Forces all Discord bridge code paths into in-process mocks (no real
// HTTP/OAuth to discord.com).
config.discordBridge.mockMode = true;

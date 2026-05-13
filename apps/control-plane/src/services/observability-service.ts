import fs from "node:fs";
import { config } from "../config.js";
import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [registry],
});

export const activeConnections = new Counter({
  name: "active_connections",
  help: "Number of active connections",
  registers: [registry],
});

export const httpErrorsTotal = new Counter({
  name: "http_errors_total",
  help: "Total number of HTTP errors (5xx)",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

export const httpRequestBodyBytes = new Histogram({
  name: "http_request_body_bytes",
  help: "Size of HTTP request bodies in bytes",
  labelNames: ["method", "route"],
  buckets: [1024, 16384, 65536, 262144, 1048576, 4194304],
  registers: [registry],
});

type LogLevel = "info" | "warn" | "error";

function writeLine(line: string): void {
  if (config.logFilePath) {
    try {
      fs.appendFileSync(config.logFilePath, `${line}\n`, "utf8");
    } catch {
      // Best-effort sink fallback to stdout.
      console.log(line);
    }
    return;
  }
  console.log(line);
}

export function logEvent(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const payload = {
    at: new Date().toISOString(),
    level,
    message,
    ...fields
  };
  writeLine(JSON.stringify(payload));
}

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

if (!config.metrics.token && config.metrics.allowedIps.length === 0) {
  logEvent("warn", "metrics_unprotected", {
    message: "Metrics endpoint has NO IP or Token restrictions! This is insecure for production."
  });
}

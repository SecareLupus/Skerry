import Fastify from "fastify";
import { STATUS_CODES } from "node:http";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import rateLimit from "@fastify/rate-limit";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerDomainRoutes } from "./routes/domain-routes.js";
import { config } from "./config.js";
import { logEvent, httpRequestsTotal, httpRequestDurationSeconds } from "./services/observability-service.js";

declare module "fastify" {
  interface FastifyRequest {
    startTime: number;
  }
}

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: config.bodyLimit });
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowedOrigins = [
        "http://localhost",
        "http://localhost:3000",
        "https://localhost",
        "https://localhost:3000",
        "http://127.0.0.1",
        "http://127.0.0.1:3000",
        "https://127.0.0.1",
        "https://127.0.0.1:3000",
        config.webBaseUrl
      ].filter(Boolean);

      if (!origin || allowedOrigins.some(ao => origin === ao || origin.startsWith(ao + "/"))) {
        cb(null, true);
        return;
      }
      cb(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(sensible);

  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      const forwardedFor = request.headers["x-forwarded-for"];
      return (typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : request.ip) || request.id;
    },
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      code: "rate_limited",
      message: `Rate limit exceeded. Retry in ${context.after}.`,
      requestId: request.id
    })
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.addHook("onRequest", async (request) => {
    request.startTime = Date.now();
  });

  app.addHook("onResponse", async (request, reply) => {
    const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
    const route = request.routeOptions?.url ?? request.url;

    httpRequestsTotal.inc({
      method: request.method,
      route,
      status_code: reply.statusCode
    });

    httpRequestDurationSeconds.observe({
      method: request.method,
      route,
      status_code: reply.statusCode
    }, duration);

    logEvent("info", "request_completed", {
      requestId: request.id,
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: Math.round(duration * 1000)
    });
  });

  app.setErrorHandler((error, request, reply) => {
    // Determine if it's a real Error or something else (like a string or plain object)
    const isStandardError = error instanceof Error;
    const parsedError = isStandardError ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error) || "Unknown Error");
    
    // Add original raw error to the parsed object for logging
    if (!isStandardError) {
      Object.assign(parsedError, { raw: error });
    }
    const statusCode = (() => {
      if (parsedError instanceof ZodError) {
        return 400;
      }
      if ("statusCode" in parsedError && typeof parsedError.statusCode === "number") {
        return parsedError.statusCode;
      }
      return 500;
    })();

    const code =
      parsedError instanceof ZodError
        ? "validation_error"
        : "code" in parsedError && typeof parsedError.code === "string"
          ? parsedError.code
          : "internal_error";
    const message =
      parsedError instanceof ZodError
        ? "Request validation failed."
        : parsedError.message || STATUS_CODES[statusCode] || "Internal Server Error";
    
    // Detect request cancellation/abortion
    const isAborted = request.raw.destroyed || reply.raw.writableEnded || 
                     parsedError.message?.includes("aborted") || 
                     (parsedError as any).code === "ECONNRESET";

    // Log full error for 500s to allow diagnostics, but skip for aborted requests
    if (statusCode === 500 && !isAborted) {
      console.error(`[CONTROL-PLANE ERROR] ${request.method} ${request.url}:`, parsedError);
      if (parsedError.stack) {
        console.error(parsedError.stack);
      }
      if (!isStandardError) {
        console.error("[RAW ERROR OBJECT]:", error);
      }
    }
    const errorLabel = STATUS_CODES[statusCode] ?? "Error";

    logEvent("error", "request_failed", {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions?.url ?? request.url,
      statusCode,
      code,
      message,
      stack: statusCode === 500 ? parsedError.stack : undefined
    });

    reply.code(statusCode).send({
      statusCode,
      error: errorLabel,
      code,
      message,
      requestId: request.id
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      statusCode: 404,
      error: "Not Found",
      code: "not_found",
      message: `Route ${request.method} ${request.url} not found.`,
      requestId: request.id
    });
  });

  await registerAuthRoutes(app);
  await registerDomainRoutes(app);
  return app;
}

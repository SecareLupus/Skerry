import Fastify from "fastify";
import { STATUS_CODES } from "node:http";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerDomainRoutes } from "./routes/domain-routes.js";
import { config } from "./config.js";
import { logEvent } from "./services/observability-service.js";

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

  const requestBuckets = new Map<string, { count: number; windowStartedAt: number }>();

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.addHook("onRequest", async (request, reply) => {
    const now = Date.now();
    const forwardedFor = request.headers["x-forwarded-for"];
    const ip = typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : request.ip;
    const route = request.routeOptions?.url ?? request.url;
    const key = `${ip}:${route}`;
    const current = requestBuckets.get(key);
    if (!current || now - current.windowStartedAt >= 60_000) {
      requestBuckets.set(key, { count: 1, windowStartedAt: now });
      return;
    }
    current.count += 1;
    if (current.count > config.rateLimitPerMinute) {
      logEvent("warn", "rate_limit_triggered", {
        requestId: request.id,
        ip,
        route
      });
      reply.code(429).send({
        statusCode: 429,
        error: "Too Many Requests",
        code: "rate_limited",
        message: "Rate limit exceeded. Retry shortly.",
        requestId: request.id
      });
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    logEvent("info", "request_completed", {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions?.url ?? request.url,
      statusCode: reply.statusCode
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const parsedError = error instanceof Error ? error : new Error("Internal Server Error");
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
    const errorLabel = STATUS_CODES[statusCode] ?? "Error";

    logEvent("error", "request_failed", {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions?.url ?? request.url,
      statusCode,
      code,
      message
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

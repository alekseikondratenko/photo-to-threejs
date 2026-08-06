/**
 * The §2.4 fallback, proved early.
 *
 * Serves the built View over plain HTTP so the panel's "open in browser" button
 * has somewhere to send people, and so hosts that never render a panel (Claude
 * Code 2.1.221) still have a working viewer.
 *
 * Started lazily — a stdio server should not open a socket unless the tool is
 * actually used.
 */
import express from "express";
import type { Server } from "node:http";
import path from "node:path";

const DIST_DIR = path.join(import.meta.dirname, "dist");

// 5199 first, per the PLAN: 5173 is silently shadowed by Docker on IPv6 on at
// least one machine. Probe upward rather than assuming 5199 is free either.
const FIRST_PORT = 5199;
const ATTEMPTS = 20;

let started: Promise<string> | undefined;

function listen(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

/** Returns the viewer URL, starting the server on first call. */
export function ensureViewerServer(): Promise<string> {
  started ??= (async () => {
    const app = express();
    app.use(express.static(DIST_DIR));
    app.get("/", (_req, res) => res.sendFile(path.join(DIST_DIR, "mcp-app.html")));

    for (let i = 0; i < ATTEMPTS; i++) {
      const port = FIRST_PORT + i;
      try {
        await listen(app, port);
        return `http://127.0.0.1:${port}/`;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
        throw e;
      }
    }
    throw new Error(`No free port in ${FIRST_PORT}–${FIRST_PORT + ATTEMPTS - 1}`);
  })();

  return started;
}

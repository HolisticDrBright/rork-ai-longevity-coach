import app from "./hono";

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`[Server] Starting on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};

console.log(`[Server] Listening on http://0.0.0.0:${port}`);

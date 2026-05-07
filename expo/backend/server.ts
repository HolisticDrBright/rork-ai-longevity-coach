// import app from "./hono";

// const port = parseInt(process.env.PORT || "3000", 10);

// console.log(`[Server] Starting on port ${port}...`);

// export default {
//   port,
//   fetch: app.fetch,
// };

// console.log(`[Server] Listening on http://0.0.0.0:${port}`);

import { serve } from "@hono/node-server";
import app from "./hono";

const port = Number(process.env.PORT || 3000);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`[Server] Running on http://0.0.0.0:${port}`);
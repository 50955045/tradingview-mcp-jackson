import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/monitor.js";

export function registerMonitorTools(server) {
  server.tool(
    "monitor_start",
    "Start background price and indicator monitoring with notifications. Requires monitor.config.json.",
    {
      config_path: z
        .string()
        .optional()
        .describe("Optional path to monitor.config.json. Defaults to project root."),
    },
    async ({ config_path } = {}) => {
      try {
        await core.start();
        const status = await core.status();
        return jsonResult({ success: true, status });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "monitor_stop",
    "Stop the background monitoring service.",
    {},
    async () => {
      try {
        await core.stop();
        return jsonResult({ success: true, message: "Monitor stopped" });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "monitor_status",
    "Check if the monitor is running and get its configuration.",
    {},
    async () => {
      try {
        const status = await core.status();
        return jsonResult({ success: true, status });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}

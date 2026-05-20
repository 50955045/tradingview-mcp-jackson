import { register } from "../router.js";
import * as core from "../../core/monitor.js";

register("monitor", {
  description: "Start, stop, or check status of background price/indicator monitor",
  subcommands: new Map([
    [
      "start",
      {
        description: "Start background monitoring (requires monitor.config.json)",
        options: {
          config: {
            type: "string",
            short: "c",
            description: "Path to monitor.config.json",
          },
        },
        handler: async ({ config }) => {
          await core.start();
          return core.status();
        },
      },
    ],
    [
      "stop",
      {
        description: "Stop background monitoring",
        handler: async () => {
          await core.stop();
          return { success: true, message: "Monitor stopped" };
        },
      },
    ],
    [
      "status",
      {
        description: "Check monitor status",
        handler: async () => core.status(),
      },
    ],
  ]),
});

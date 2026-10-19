import { resolve } from "node:path";
import { startLocalHub } from "./server.js";
const args = process.argv.slice(2); const value = (flag: string) => args[args.indexOf(flag) + 1];
const hub = await startLocalHub({ port: Number(value("--port") ?? 8787), dataFile: resolve(value("--data") ?? ".mireva/hub.json") });
console.log(`Mireva Hub local running at ${hub.url}`);
process.on("SIGINT", () => void hub.close().then(() => process.exit(0)));

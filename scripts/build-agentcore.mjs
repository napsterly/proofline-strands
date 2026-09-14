import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/server.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/agentcore.js",
  external: ["@aws-sdk/client-s3"],
  banner: { js: "import { createRequire as __prooflineCreateRequire } from 'node:module'; const require = __prooflineCreateRequire(import.meta.url);" },
  logLevel: "info",
});
await writeFile("dist/package.json", JSON.stringify({ type: "module" }, null, 2) + "\n");

import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const deploymentDirectory = "prooflineagentcore/app/ProoflineStrands";
await mkdir(deploymentDirectory, { recursive: true });
// The AgentCore CodeZip packager validates this directory even though the
// bundle has no production npm dependencies.
await mkdir(`${deploymentDirectory}/node_modules`, { recursive: true });

const buildOptions = {
  entryPoints: ["src/server.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@aws-sdk/client-s3"],
  banner: { js: "import { createRequire as __prooflineCreateRequire } from 'node:module'; const require = __prooflineCreateRequire(import.meta.url);" },
  logLevel: "info",
};

await build({ ...buildOptions, outfile: "dist/agentcore.js" });
await build({ ...buildOptions, outfile: `${deploymentDirectory}/main.js` });

const runtimePackage = JSON.stringify({
  name: "proofline-strands-runtime",
  version: "1.0.0",
  private: true,
  type: "module",
}, null, 2) + "\n";
await writeFile("dist/package.json", runtimePackage);
await writeFile(`${deploymentDirectory}/package.json`, runtimePackage);

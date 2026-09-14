// AgentCore's TypeScript packager selects main.ts for NODE_22 CodeZip builds.
// The application itself is bundled from the audited source tree by
// scripts/build-agentcore.mjs, so this wrapper makes the packager consume that
// deterministic artifact instead of the CLI's starter example.
import "./main.js";

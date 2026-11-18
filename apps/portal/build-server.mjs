// Bundles the server into a single ESM file. Version comes from the root package.json or PORTAL_VERSION.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const version = process.env.PORTAL_VERSION ?? JSON.parse(readFileSync(new URL("../../package.json", import.meta.url))).version;
await build({
  entryPoints: ["server/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // ssh2 has optional native add-ons; the pure JS fallback is used when they are missing.
  external: ["cpu-features", "./crypto/build/Release/sshcrypto.node"],
  banner: {
    js: [
      "import { createRequire as __pCreateRequire } from 'node:module';",
      "import { fileURLToPath as __pFileURLToPath } from 'node:url';",
      "import { dirname as __pDirname } from 'node:path';",
      "const require = __pCreateRequire(import.meta.url);",
      "const __filename = __pFileURLToPath(import.meta.url);",
      "const __dirname = __pDirname(__filename);",
    ].join("\n"),
  },
  define: { __PORTAL_VERSION__: JSON.stringify(version) },
  logLevel: "info",
});

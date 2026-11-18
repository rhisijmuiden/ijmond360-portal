// Selects the house style the apps are built with.
// Order: PORTAL_BRAND env var, then branding/active-brand, then "ijmond360".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function activeBrand() {
  const file = join(here, "active-brand");
  const name = (process.env.PORTAL_BRAND || (existsSync(file) ? readFileSync(file, "utf8") : "") || "ijmond360").trim();
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(here, name, "tokens.css"))) {
    throw new Error(`Unknown brand "${name}": expected branding/${name}/tokens.css`);
  }
  return name;
}

/** Absolute path of the active brand's folder; Vite apps alias it as "@brand". */
export function brandDir() {
  return join(here, activeBrand());
}

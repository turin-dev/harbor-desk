import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const source = readFileSync(
  join(root, "apps", "gateway", "src", "app.ts"),
  "utf8",
);
const specText = readFileSync(
  join(root, "packages", "contracts", "openapi.yaml"),
  "utf8",
);

const doc = parseDocument(specText);
const syntaxErrors = doc.errors.filter(
  (error) => error.name !== "YamlMapError",
);
for (const error of doc.errors) {
  if (
    error.name === "YamlMapError" &&
    !/duplicated mapping key/i.test(error.message)
  ) {
    syntaxErrors.push(error);
  }
}
if (syntaxErrors.length > 0) {
  for (const error of syntaxErrors) {
    console.error("openapi.yaml: " + error.message);
  }
  process.exit(1);
}
const duplicateKeys = doc.errors.filter((error) =>
  /duplicated mapping key/i.test(error.message),
);
if (duplicateKeys.length > 0) {
  for (const error of duplicateKeys) {
    console.error("openapi.yaml duplicate key: " + error.message);
  }
  process.exit(1);
}

const spec = doc.toJS();
if (!spec || typeof spec.paths !== "object" || spec.paths === null) {
  console.error("openapi.yaml: missing paths section");
  process.exit(1);
}

const specRoutes = new Set();
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of [
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "options",
    "head",
  ]) {
    if (item[method]) {
      specRoutes.add(method.toUpperCase() + " " + path);
    }
  }
}

const routePattern =
  /app\.(get|post|delete|put|patch)\(\s*[\"'`]([^\"'`]+)[\"'`]/g;
const routePaths = new Set();
let match;
while ((match = routePattern.exec(source)) !== null) {
  const method = match[1].toUpperCase();
  const path = match[2]
    .split("/")
    .map((part) => (part.startsWith(":") ? "{" + part.slice(1) + "}" : part))
    .join("/");
  routePaths.add(method + " " + path);
}

const missing = [...routePaths].filter((route) => !specRoutes.has(route));
const stale = [...specRoutes]
  .filter((route) => !routePaths.has(route))
  .filter(
    (route) => !route.startsWith("OPTIONS ") && !route.startsWith("HEAD "),
  );
if (missing.length > 0 || stale.length > 0) {
  if (missing.length > 0) {
    console.error(
      "OpenAPI contract drift detected: gateway routes missing from the spec",
    );
    for (const route of missing.sort()) {
      console.error("  missing: " + route);
    }
  }
  if (stale.length > 0) {
    console.error(
      "OpenAPI contract drift detected: spec entries with no gateway route",
    );
    for (const route of stale.sort()) {
      console.error("  stale: " + route);
    }
  }
  process.exit(1);
}
const pathCount = Object.keys(spec.paths).length;
const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
console.log(
  "openapi-route-check: " +
    routePaths.size +
    " gateway routes and " +
    specRoutes.size +
    " spec entries match bidirectionally (" +
    pathCount +
    " paths, " +
    schemaCount +
    " schemas)",
);

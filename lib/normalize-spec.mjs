/**
 * Normalizes verbose English sentence operationIds in the OpenAPI spec to short,
 * REST-conventional camelCase identifiers.
 *
 * Rules:
 *   GET  /…/collection/          → list{Resource}s
 *   GET  /…/collection/{id}/     → get{Resource}       (singularize last segment)
 *   POST /…/collection/          → create{Resource}    (singular — creating one item)
 *   PUT/PATCH /…/resource/{id}/  → update{Resource}
 *   DELETE /…/resource/{id}/     → delete{Resource}
 *   DELETE /…/collection/        → delete{Resource}s   (bulk)
 *
 * Any operationId that is already an identifier (no spaces) is left untouched —
 * those were set intentionally via @extend_schema(operation_id=...).
 */

import { readFileSync, writeFileSync } from "node:fs";

const IRREGULAR = {
  activities: "activity",
  queries: "query",
  aliases: "alias",
  indices: "index",
  statuses: "status",
  checkins: "checkin",
  analyses: "analysis",
};

function singularize(word) {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  // Regular -s removal: handles words like releases→release, teams→team, issues→issue.
  // Avoid mutating words ending in -ss (class), -us (status), -is (analysis).
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function normalizeOperationId(method, path) {
  const clean = path.replace(/^\/api\/0\//, "").replace(/\/$/, "");
  const segments = clean.split("/");
  const lastSeg = segments[segments.length - 1] ?? "";
  const isDetail = lastSeg.startsWith("{");

  const verb =
    method === "get"
      ? isDetail
        ? "get"
        : "list"
      : method === "post"
        ? "create"
        : method === "put" || method === "patch"
          ? "update"
          : method === "delete"
            ? "delete"
            : method;

  const parts = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.startsWith("{")) continue;

    // Convert kebab-case to camelCase: events-timeseries → eventsTimeseries
    const camel = seg.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

    // Singularize segments that scope a specific resource (immediately followed by a param)
    const nextSeg = segments[i + 1] ?? "";
    const followedByParam = nextSeg.startsWith("{");
    parts.push(followedByParam ? singularize(camel) : camel);
  }

  // Also singularize the last resource segment for detail GETs and creates
  if ((isDetail || verb === "create") && parts.length > 0) {
    parts[parts.length - 1] = singularize(parts[parts.length - 1]);
  }

  const resource = parts
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("");

  return verb + (resource ? resource[0].toUpperCase() + resource.slice(1) : "");
}

/**
 * Reads the spec at `inputPath`, rewrites all sentence-style operationIds to
 * short REST-conventional names, and writes the result to `outputPath`.
 *
 * @param {string} inputPath  - Path to the source spec (e.g. openapi-derefed.json)
 * @param {string} outputPath - Path to write the normalized spec to
 */
export function normalizeSpec(inputPath, outputPath) {
  const spec = JSON.parse(readFileSync(inputPath, "utf8"));

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== "object" || !op.operationId) continue;
      // Leave identifiers that have no spaces — they were set intentionally
      if (!/\s/.test(op.operationId)) continue;
      op.operationId = normalizeOperationId(method, path);
    }
  }

  writeFileSync(outputPath, JSON.stringify(spec));
}

export { normalizeOperationId, singularize };

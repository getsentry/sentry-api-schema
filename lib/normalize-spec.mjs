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

// ---------------------------------------------------------------------------
// Singularization
// ---------------------------------------------------------------------------

const IRREGULAR = {
  activities: "activity",
  queries: "query",
  aliases: "alias",
  indices: "index",
  statuses: "status",
  checkins: "checkin",
  analyses: "analysis",
};

/**
 * Returns the singular form of a lowercase English noun.
 *
 * Handles the most common patterns found in Sentry API path segments.
 * Returns the word unchanged when no rule applies or when slicing would
 * produce an empty string (e.g. the single-character input "s").
 *
 * @param {string} word - Lowercase noun, e.g. "issues", "activities"
 * @returns {string} Singular form, e.g. "issue", "activity"
 */
export function singularize(word) {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  // Skip -ss (class), -us (status), -is (analysis) — already singular.
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    const stem = word.slice(0, -1);
    return stem.length > 0 ? stem : word;
  }
  return word;
}

// ---------------------------------------------------------------------------
// Path parsing
// ---------------------------------------------------------------------------

/** Hyphens and underscores → camelCase: events-timeseries → eventsTimeseries */
function toCamel(s) {
  return s.replace(/[-_]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Singularizes the last word of a hyphen/underscore-separated segment, then
 * converts the whole thing to camelCase.
 *
 * Singularizing the last word (not the full camelCase string) is critical for
 * compound segments: "release-threshold-statuses" must become
 * "releaseThresholdStatus", not "releaseThresholdStatuse". By splitting first,
 * singularize() receives "statuses" and can match the IRREGULAR table.
 */
function toSingularCamel(s) {
  const words = s.split(/[-_]/);
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
}

/**
 * Parses an API path into an array of segment descriptors.
 *
 * Each descriptor carries:
 *   - `value`: the segment converted to camelCase (plural kept)
 *   - `singularValue`: the segment with its last word singularized, then camelCased
 *   - `isParam`: true when the segment is a path parameter ({…})
 *   - `followedByParam`: true when the next segment is a path parameter
 *
 * Empty segments (from leading/double slashes) are dropped upfront.
 *
 * @param {string} path - e.g. "/api/0/organizations/{org}/issues/{id}/"
 * @returns {{ value: string; singularValue: string; isParam: boolean; followedByParam: boolean }[]}
 */
export function parsePath(path) {
  const clean = path.replace(/^\/api\/0\//, "").replace(/\/$/, "");
  const raw = clean.split("/").filter((s) => s.length > 0);

  return raw.map((s, i) => {
    const isParam = s.startsWith("{");
    return {
      value:         isParam ? s : toCamel(s),
      singularValue: isParam ? s : toSingularCamel(s),
      isParam,
      followedByParam: raw[i + 1]?.startsWith("{") ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

const VERBS = {
  post: "create",
  put: "update",
  patch: "update",
  delete: "delete",
};

/**
 * Derives a short, REST-conventional camelCase identifier from an HTTP method
 * and URL path.
 *
 * @param {string} method - HTTP method (lowercase: "get", "post", …)
 * @param {string} path   - Full path, e.g. "/api/0/organizations/{org}/issues/{id}/"
 * @returns {string} Normalized identifier, e.g. "getOrganizationIssue"
 * @throws {Error} If the path has no static segments and cannot produce a name
 */
export function normalizeOperationId(method, path) {
  const segments = parsePath(path);
  const statics = segments.filter((s) => !s.isParam);

  if (statics.length === 0) {
    throw new Error(
      `normalizeOperationId: no static segments in path "${path}" ` +
        `(${method.toUpperCase()}). Set operation_id explicitly via ` +
        `@extend_schema(operation_id=...).`,
    );
  }

  const isDetail = segments.at(-1)?.isParam ?? false;
  const verb = method === "get" ? (isDetail ? "get" : "list") : (VERBS[method] ?? method);

  // Apply singularization in a single pass:
  //   - any segment immediately before a {param} scopes a specific resource
  //   - the final segment for detail GETs and creates (operating on one item)
  const parts = statics.map((s, i) => {
    const isLast = i === statics.length - 1;
    const needsSingular = s.followedByParam || (isLast && (isDetail || verb === "create"));
    return needsSingular ? s.singularValue : s.value;
  });

  const resource = parts
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("");

  return verb + resource[0].toUpperCase() + resource.slice(1);
}

// ---------------------------------------------------------------------------
// Spec rewriting
// ---------------------------------------------------------------------------

/**
 * Reads the spec at `inputPath`, rewrites all sentence-style operationIds to
 * short REST-conventional names, and writes the result to `outputPath`.
 *
 * Throws on name collisions — two operations normalizing to the same identifier
 * would produce duplicate SDK exports, which must be resolved explicitly via
 * @extend_schema(operation_id=...) on the backend endpoint.
 *
 * @param {string} inputPath  - Path to the source spec (e.g. openapi-derefed.json)
 * @param {string} outputPath - Path to write the normalized spec to
 */
export function normalizeSpec(inputPath, outputPath) {
  // JSON.parse produces a fresh object every call; mutations are safe and
  // intentional — we rewrite operationIds in place before serialising.
  const spec = JSON.parse(readFileSync(inputPath, "utf8"));
  // Track every final operationId (rewritten or pre-existing) so that a manually
  // set clean identifier cannot collide with a path-derived one without detection.
  const seen = new Map(); // final operationId → "METHOD /path" that first claimed it

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== "object" || op === null || !op.operationId) continue;

      const ref = `${method.toUpperCase()} ${path}`;

      if (!/\s/.test(op.operationId)) {
        // Already a clean identifier — register it so sentence-style rewrites
        // on other paths cannot silently collide with it.
        const claimedBy = seen.get(op.operationId);
        if (claimedBy) {
          throw new Error(
            `normalizeSpec: collision — "${op.operationId}" claimed by both ` +
              `"${claimedBy}" and "${ref}". ` +
              `Set operation_id explicitly on one of them via @extend_schema(operation_id=...).`,
          );
        }
        seen.set(op.operationId, ref);
        continue;
      }

      const normalized = normalizeOperationId(method, path);
      const claimedBy = seen.get(normalized);
      if (claimedBy) {
        throw new Error(
          `normalizeSpec: collision — "${normalized}" claimed by both ` +
            `"${claimedBy}" and "${ref}". ` +
            `Set operation_id explicitly on one of them via @extend_schema(operation_id=...).`,
        );
      }
      seen.set(normalized, ref);
      op.operationId = normalized;
    }
  }

  writeFileSync(outputPath, JSON.stringify(spec));
}

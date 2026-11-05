import { UserInputError } from "./errors.js";

/**
 * Encode one Sentry API path identifier without letting it become a URL path.
 *
 * URL parsing collapses bare `.` and `..` segments even after
 * `encodeURIComponent`, so callers must reject those identifiers before
 * constructing a request. The caller owns its product-specific error type.
 * A pre-encoded spelling such as `%2e%2e` is safe: encoding its percent signs
 * prevents the URL parser from treating it as a dot segment.
 */
export function encodeApiPathSegment(value: string | number): string | null {
  const text = String(value);
  return text === "." || text === ".." ? null : encodeURIComponent(text);
}

/**
 * Assemble an API URL from a product-validated base and a relative endpoint.
 * This does not decide which host is trusted or which region an org uses.
 */
export function buildSentryApiUrl(baseUrl: string, endpoint: string): string {
  const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charAt(end - 1) === "/") {
    end -= 1;
  }
  return `${baseUrl.slice(0, end)}/api/0/${path}`;
}

/**
 * Builds an API request path, confining each interpolated value to one path segment.
 *
 * `fetch` resolves dot segments during URL parsing, so a raw value in a path can
 * rewrite it above the org and project the server injected. Encoding stops separators
 * but not `.` or `..`, which survive encoding and still collapse (the URL spec treats
 * `%2e%2e` as a dot segment too), so those are rejected instead.
 *
 * Query strings go outside the template, since `URLSearchParams` has already encoded
 * them and their separators must stay literal:
 *
 * ```typescript
 * const path = apiPath`/organizations/${organizationSlug}/issues/`;
 * await this.requestJSON(`${path}?${query}`);
 * ```
 */
export function apiPath(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  return strings.reduce((acc, literal, index) => {
    if (index >= values.length) {
      return acc + literal;
    }

    const value = String(values[index]);
    const encoded = encodeApiPathSegment(value);
    if (encoded === null) {
      throw new UserInputError(
        `Invalid identifier "${value}": relative path segments are not allowed.`,
      );
    }

    return acc + literal + encoded;
  }, "");
}

/** The organization, and project when present, an API path targets. */
export type ApiPathScope = { organization: string; project?: string };

/**
 * Org and project slugs or numeric ids. Rejects schema placeholders such as
 * `{organization_id_or_slug}`, encoded values, and dot segments.
 */
const API_PATH_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function isApiPathIdentifier(segment: string | undefined): segment is string {
  return segment !== undefined && API_PATH_IDENTIFIER.test(segment);
}

/** Path segments after `/api/0/`, or undefined for a URL outside the API. */
function apiPathSegments(urlOrPath: string): string[] | undefined {
  const isUrl = URL.canParse(urlOrPath);
  const path = isUrl
    ? new URL(urlOrPath).pathname
    : (urlOrPath.split(/[?#]/, 1)[0] ?? "");
  const segments = path.split("/").filter((segment) => segment.length > 0);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "api" && segments[index + 1] === "0") {
      return segments.slice(index + 2);
    }
  }
  return isUrl ? undefined : segments;
}

/**
 * The organization, and project when present, a Sentry API request targets,
 * read from its path: `/organizations/{org}/`, `/projects/{org}/{project}/`,
 * `/teams/{org}/`, and `/organizations/{org}/projects/{project}/`.
 *
 * Accepts a full URL, whose path must contain `/api/0/` (a self-hosted
 * install may serve it under a prefix), or a path relative to `/api/0/` with
 * or without that prefix. Undefined for unscoped paths, list endpoints such
 * as `/organizations/`, and schema placeholders.
 *
 * Hosts with several credentials use it to pick the one that can reach the
 * organization; {@link createApiTransport} passes it to
 * `CredentialProvider.current`.
 */
export function parseApiPathScope(urlOrPath: string): ApiPathScope | undefined {
  const segments = apiPathSegments(urlOrPath);
  if (!segments) {
    return;
  }
  const [resource, organization, next, project] = segments;
  if (!isApiPathIdentifier(organization)) {
    return;
  }
  if (resource === "organizations") {
    return next === "projects" && isApiPathIdentifier(project)
      ? { organization, project }
      : { organization };
  }
  if (resource === "projects") {
    return isApiPathIdentifier(next)
      ? { organization, project: next }
      : { organization };
  }
  if (resource === "teams") {
    return { organization };
  }
  return;
}

/** `path` with `query` appended, or `path` alone when `query` is empty. */
export function withQuery(path: string, query: URLSearchParams): string {
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

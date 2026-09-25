import { describe, expect, it, spyOn } from "bun:test";
import {
  bearerToken,
  createSentryClient,
  listOrganizations,
  type FetchFn,
} from "@sentry/api";
import { browserSession, createBrowserSdkConfig } from "@sentry/api/browser";

function captureRequests(body: unknown = [], status = 200) {
  const requests: Request[] = [];
  const fetch: FetchFn = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(body, { status });
  };
  return { requests, fetch };
}

describe("configured public client", () => {
  it.each([
    [undefined, "https://sentry.io"],
    ["https://us.sentry.io", "https://us.sentry.io"],
    ["https://de.sentry.io", "https://de.sentry.io"],
    ["https://tenant.my.sentry.io", "https://tenant.my.sentry.io"],
    ["https://sentry.example.test", "https://sentry.example.test"],
    ["http://localhost:9000", "http://localhost:9000"],
  ])("preserves the configured origin %s without discovery", async (baseUrl, origin) => {
    const { requests, fetch } = captureRequests();
    const client = createSentryClient(bearerToken({
      token: "test-token",
      baseUrl,
      headers: { "X-Test-Client": "sdk" },
      fetch,
    }));

    const result = await listOrganizations({ client });

    expect(result.data).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`${origin}/api/0/organizations/`);
    expect(requests[0]!.headers.get("Authorization")).toBe("Bearer test-token");
    expect(requests[0]!.headers.get("X-Test-Client")).toBe("sdk");
  });

  it("isolates hosts and credentials across concurrent clients", async () => {
    const { requests, fetch } = captureRequests();
    const first = createSentryClient(bearerToken({
      token: "first-token", baseUrl: "https://first.my.sentry.io", fetch,
    }));
    const second = createSentryClient(bearerToken({
      token: "second-token", baseUrl: "https://second.example.test", fetch,
    }));

    await Promise.all([
      listOrganizations({ client: first }),
      listOrganizations({ client: second }),
    ]);

    expect(requests.map(request => [request.url, request.headers.get("Authorization")]).sort()).toEqual([
      ["https://first.my.sentry.io/api/0/organizations/", "Bearer first-token"],
      ["https://second.example.test/api/0/organizations/", "Bearer second-token"],
    ]);
  });

  it("keeps per-call overrides separate from the client's configuration", async () => {
    const { requests, fetch } = captureRequests();
    const client = createSentryClient(bearerToken({
      token: "unused-token",
      baseUrl: "https://original.example.test",
      headers: { Authorization: "Bearer original-token" },
      fetch,
    }));

    await listOrganizations({
      client,
      baseUrl: "https://override.example.test",
      headers: { Authorization: "Bearer override-token" },
    });
    await listOrganizations({ client });

    expect(requests.map(request => [request.url, request.headers.get("Authorization")])).toEqual([
      ["https://override.example.test/api/0/organizations/", "Bearer override-token"],
      ["https://original.example.test/api/0/organizations/", "Bearer original-token"],
    ]);
  });

  it("uses the same configured transport for an operation without generated types", async () => {
    const body = { user: { id: "test-user" } };
    const { requests, fetch } = captureRequests(body);
    const client = createSentryClient(bearerToken({
      token: "test-token", baseUrl: "https://tenant.my.sentry.io", fetch,
    }));

    const result = await client.get({ url: "/api/0/auth/" });

    expect(result.data).toEqual(body);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://tenant.my.sentry.io/api/0/auth/");
    expect(requests[0]!.headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("applies the configured error policy to generated operations", async () => {
    const body = { detail: "Invalid token" };
    const { fetch } = captureRequests(body, 401);
    const returning = createSentryClient(bearerToken({ token: "test", fetch }));
    const throwing = createSentryClient(bearerToken({ token: "test", fetch, throwOnError: true }));

    const result = await listOrganizations({ client: returning });
    expect(result.error).toEqual(body);
    expect(result.response.status).toBe(401);
    await expect(listOrganizations({ client: throwing })).rejects.toEqual(body);
  });
});

describe("public browser configuration", () => {
  it.each([
    ["browserSession", browserSession],
    ["createBrowserSdkConfig", createBrowserSdkConfig],
  ] as const)("keeps cookie and CSRF authentication with %s", async (_name, configure) => {
    const mock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ slug: "example" }));
    try {
      const client = createSentryClient(configure({
        baseUrl: "https://sentry.example.test",
        getCsrfToken: () => "test-csrf",
      }));

      const result = await client.post({
        url: "/api/0/organizations/",
        body: { slug: "example" },
      });

      expect(result.data).toEqual({ slug: "example" });
      expect(mock).toHaveBeenCalledTimes(1);
      const [input, init] = mock.mock.calls[0]!;
      const request = new Request(input, init);
      expect(request.url).toBe("https://sentry.example.test/api/0/organizations/");
      expect(request.method).toBe("POST");
      expect(request.headers.get("X-CSRFToken")).toBe("test-csrf");
      expect(request.headers.has("Authorization")).toBe(false);
      expect(request.credentials).toBe("include");
    } finally {
      mock.mockRestore();
    }
  });
});

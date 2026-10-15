import assert from "node:assert/strict";
import { test } from "node:test";
import { createSentryClient } from "../dist/index.js";
import { createBrowserFetch } from "../dist/browser.js";

// Bun 1.3.3 does not detach a cloned Request's signal for signal: null.
// Run these native Request composition checks in Node, without a polyfill.
test("browser fetch detaches an aborted Request with an explicit null signal", async (t) => {
  const request = new Request("https://example.test/api/0/organizations/", {
    signal: AbortSignal.abort(new Error("Original cancelled")),
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const effective = new Request(input, init);
    assert.equal(effective.signal.aborted, false);
    return Response.json([]);
  });

  const response = await createBrowserFetch()(request, { signal: null });
  assert.deepEqual(await response.json(), []);
  assert.equal(request.signal.aborted, true);
});

test("SDK respects an interceptor clearing the caller's aborted signal", async () => {
  let dispatched = 0;
  const sentry = createSentryClient({
    baseUrl: "https://example.test",
    fetch: async (request) => {
      assert.equal(request.signal.aborted, false);
      dispatched++;
      return Response.json([]);
    },
  });
  sentry.client.interceptors.request.use(request => new Request(request, { signal: null }));

  const result = await sentry.listOrganizations({
    signal: AbortSignal.abort(new Error("Caller cancelled")),
    throwOnError: true,
  });
  assert.deepEqual(result.data, []);
  assert.equal(dispatched, 1);
});

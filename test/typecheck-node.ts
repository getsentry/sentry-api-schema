// Server consumers must be able to import the public client without DOM types.
import { bearerToken, createSentryClient, listOrganizations, type FetchFn } from "@sentry/api";

const fetch: FetchFn = async (input, init) => {
  const request = new Request(input, init);
  return globalThis.fetch(request);
};

async function nodeClientConfiguration() {
  const client = createSentryClient(bearerToken({ token: "test", fetch }));
  const result = await listOrganizations({ client });
  void result.data;
}

void nodeClientConfiguration;

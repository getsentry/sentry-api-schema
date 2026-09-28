/** Public-package type checks for the bound operation facade; never executed. */
import {
  createSentryClient,
  listOrganizations,
  paginateAll_listOrganizations,
  type Config,
  type SentryClient,
} from "@sentry/api";
import type * as operations from "../src/sdk.gen";

type OperationNames = keyof typeof operations;
type BoundOperationNames = Exclude<keyof SentryClient, "client" | "fetchPage" | "paginateAll" | "paginateUpTo">;
// Both directions catch missing operations and accidental additional exports.
const completeSurface: [OperationNames] extends [BoundOperationNames] ? true : false = true;
const exactSurface: [BoundOperationNames] extends [OperationNames] ? true : false = true;
void [completeSurface, exactSurface];

function publicFactory() {
  const config: Config = { baseUrl: "https://example.test" };
  const configured: SentryClient = createSentryClient(config);
  const defaults: SentryClient = createSentryClient();
  configured.client.setConfig(config);
  configured.client.interceptors.request.use(request => request);
  // @ts-expect-error Replacing the raw transport would not rebind closed-over methods.
  configured.client = defaults.client;
  // @ts-expect-error Bound operation properties are readonly.
  configured.listOrganizations = defaults.listOrganizations;
  void defaults;
  return configured;
}

async function operationArguments(sentry: SentryClient) {
  await sentry.listOrganizations();
  await sentry.listOrganizations({ query: { owner: true }, signal: new AbortController().signal });
  await sentry.getOrganization({ path: { organization_id_or_slug: "example" } });
  await sentry.createOrganizationDashboard({
    path: { organization_id_or_slug: "example" },
    body: { title: "Overview" },
  });

  // @ts-expect-error Required operation options must not become optional.
  await sentry.getOrganization();
  // @ts-expect-error Required path parameters must remain required.
  await sentry.getOrganization({});
  // @ts-expect-error A required mutation body must remain required.
  await sentry.createOrganizationDashboard({ path: { organization_id_or_slug: "example" } });
  // @ts-expect-error The generated body shape must not become any.
  await sentry.createOrganizationDashboard({ path: { organization_id_or_slug: "example" }, body: { title: 1 } });
  // @ts-expect-error Query parameters retain their declared types.
  await sentry.listOrganizations({ query: { owner: "yes" } });
  // @ts-expect-error The bound context cannot be replaced through operation options.
  await sentry.listOrganizations({ client: sentry.client });
}

async function responseAndThrowingTypes(sentry: SentryClient, throwOnError: boolean) {
  const path = { organization_id_or_slug: "example" };
  const returning = await sentry.getOrganization({ path });
  // @ts-expect-error The default non-throwing result still has an error branch.
  returning.data.slug;
  if (returning.data) {
    const slug: string = returning.data.slug;
    void slug;
  }

  const throwing = await sentry.getOrganization({ path, throwOnError: true });
  const slug: string = throwing.data.slug;
  // @ts-expect-error Successful response fields retain their concrete type.
  const wrongSlug: number = throwing.data.slug;
  // @ts-expect-error The throwOnError:true result has no error field.
  throwing.error;

  const explicit = await sentry.getOrganization<true>({ path, throwOnError: true });
  const explicitSlug: string = explicit.data.slug;
  const conditional = await sentry.getOrganization({ path, throwOnError });
  // @ts-expect-error A boolean flag must preserve the possible error branch.
  conditional.data.slug;

  const { listOrganizations: detached } = sentry;
  const organizations = await detached({ throwOnError: true });
  const firstSlug: string | undefined = organizations.data[0]?.slug;
  const response: Response = organizations.response;
  void [slug, wrongSlug, explicitSlug, firstSlug, response];
}

async function standaloneInteroperability(sentry: SentryClient) {
  const named = await listOrganizations({ client: sentry.client, throwOnError: true });
  const paginated = await paginateAll_listOrganizations({ client: sentry.client });
  const first: string | undefined = named.data[0]?.slug;
  const second: string | undefined = paginated[0]?.slug;
  void [first, second];
}

void publicFactory;
void operationArguments;
void responseAndThrowingTypes;
void standaloneInteroperability;

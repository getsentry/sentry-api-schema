/** Public-package pagination type contracts; never executed. */
import { type SentryClient } from "@sentry/api";
import type * as pagination from "../src/pagination.gen";

type Kind = "fetchPage" | "paginateAll" | "paginateUpTo";
type Bind<Function> = Function extends (options: infer Options, ...args: infer Args) => infer Result
  ? (options: Omit<Options, "client">, ...args: Args) => Result
  : never;
type Expected<Prefix extends Kind> = {
  [Name in keyof typeof pagination as Name extends `${Prefix}_${infer Operation}` ? Operation : never]:
    Bind<typeof pagination[Name]>;
};
type ExactNames<Prefix extends Kind> =
  Exclude<keyof SentryClient[Prefix], keyof Expected<Prefix>> |
  Exclude<keyof Expected<Prefix>, keyof SentryClient[Prefix]>;
const complete: { [Prefix in Kind]: ExactNames<Prefix> extends never ? true : false } = {
  fetchPage: true,
  paginateAll: true,
  paginateUpTo: true,
};
const signatures: {
  [Prefix in Kind]: SentryClient[Prefix] extends Expected<Prefix>
    ? Expected<Prefix> extends SentryClient[Prefix] ? true : false
    : false;
} = { fetchPage: true, paginateAll: true, paginateUpTo: true };
void [complete, signatures];

async function pageTypes(sentry: SentryClient) {
  const options = { path: { organization_id_or_slug: "example" } };
  const page = await sentry.fetchPage.listOrganizationProjects(options, "opaque:0:0");
  const slug: string | undefined = page.data[0]?.slug;
  const response: Response = page.response;
  const header: string | null = response.headers.get("X-Hits");
  const next: string | undefined = page.nextCursor;
  void [slug, header, next];

  // @ts-expect-error A required path remains required.
  await sentry.fetchPage.listOrganizationProjects({});
  // @ts-expect-error Cursor belongs in the helper's separate argument.
  await sentry.fetchPage.listOrganizationProjects({ ...options, query: { cursor: "x" } });
  // @ts-expect-error A bound helper cannot accept another transport.
  await sentry.fetchPage.listOrganizationProjects({ ...options, client: sentry.client });
  // @ts-expect-error Existing query parameters remain typed.
  await sentry.fetchPage.listOrganizations({ query: { owner: "yes" } });
  // @ts-expect-error Cursor remains a string.
  await sentry.fetchPage.listOrganizationProjects(options, 1);
  // @ts-expect-error Bound helper properties are readonly.
  sentry.fetchPage.listOrganizationProjects = sentry.fetchPage.listOrganizationProjects;
}

async function collectionTypes(sentry: SentryClient) {
  const options = { path: { organization_id_or_slug: "example" } };
  const all = await sentry.paginateAll.listOrganizationProjects(options);
  const batch = await sentry.paginateUpTo.listOrganizationProjects(options, {
    limit: 250,
    startCursor: "opaque:0:0",
  });
  const slug: string | undefined = all[0]?.slug;
  const batchSlug: string | undefined = batch.data[0]?.slug;
  void [slug, batchSlug];

  // @ts-expect-error Bounded collection requires a budget.
  await sentry.paginateUpTo.listOrganizationProjects(options);
  // @ts-expect-error A budget requires an item limit.
  await sentry.paginateUpTo.listOrganizationProjects(options, {});
  // @ts-expect-error Array-only collection helpers must not appear for compound bodies.
  sentry.paginateAll.listProjectReplayClicks;
  // @ts-expect-error Array-only collection helpers must not appear for compound bodies.
  sentry.paginateUpTo.listProjectReplayClicks;
  // @ts-expect-error A collection does not have a single HTTP response.
  batch.response;
}

void pageTypes;
void collectionTypes;

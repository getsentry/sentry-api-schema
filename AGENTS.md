<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/loreai) -->
## Long-term Knowledge

### Architecture

<!-- lore:019de1e9-ce0c-7423-a68e-56eabc7ee584 -->
* **getsentry/cli detectAgent() returns string | undefined, not AgentInfo**: After the detect-agent refactor (post-PR #896), \`detectAgent()\` returns a plain \`string | undefined\` (the agent name), not the former \`AgentInfo\` object (\`{ name, version?, role? }\`). The \`normalizeAgent\`, \`AGENT\_ALIASES\`, and \`AgentInfo\` type were removed. Process-tree detection (\`detectAgentFromProcessTree()\`) also returns \`string | undefined\`. Use \`detectAgent()\` synchronously for banner/UI gating; use \`detectAgentFromProcessTree()\` for async telemetry.

### Gotcha

<!-- lore:019de1e9-ce02-7f0f-b181-25636e00013a -->
* **getsentry/cli PR branches must be rebased onto main before review**: This repo moves fast — PRs forked from a base that is even a few commits behind main will show a massive diff (deletions of unrelated features) when compared against main. Always check \`git log origin/main..HEAD\` vs \`git diff origin/main...HEAD\` (three-dot) before reviewing or merging. A clean PR should diff to only its intended files. If not, rebase with \`git fetch origin && git rebase origin/main\` before pushing.

<!-- lore:019df4f6-05f5-7bcb-b954-c670444b1d4e -->
* **sentry-api-schema /events/ dataset enum is incomplete — blocks SDK adoption**: The OpenAPI spec for \`GET /api/0/organizations/{org}/events/\` had two blockers preventing CLI migration to the generated SDK: (1) \`dataset\` enum only listed \`\['logs', 'profile\_functions', 'spans', 'uptime\_results']\` — missing \`'transactions'\`, \`'errors'\`, \`'discover'\`; (2) \`cursor\` parameter was not declared at all, despite 3 of 4 call sites using it for pagination. Both fixed in sentry PR #114787: widen \`VisibilityParams.DATASET\` enum in \`parameters.py\`, add \`CursorQueryParam\` to \`@extend\_schema\` parameters in \`organization\_events.py\`. Pattern: paginated endpoints declare cursor via \`CursorQueryParam\` serializer class (42 endpoints use this pattern). After these fixes, PR #69's wrapper generator auto-detects the endpoint and emits typed pagination wrappers, unblocking all 4 raw \`apiRequestToRegion\` call sites.

### Pattern

<!-- lore:019de1e9-ce08-7b44-bff2-3de8729e0f93 -->
* **getsentry/cli uses setEnv/getEnv for env isolation in tests**: The repo isolates environment variables via \`src/lib/env.ts\` — \`setEnv(env)\` overrides the active env, \`getEnv()\` returns it. Tests that depend on env vars should call \`setEnv({ VAR: 'val' } as NodeJS.ProcessEnv)\` and restore with \`setEnv(process.env)\` in a \`try/finally\`. Detection functions like \`detectAgent()\` read from \`getEnv()\`, not \`process.env\` directly.
<!-- End lore-managed section -->

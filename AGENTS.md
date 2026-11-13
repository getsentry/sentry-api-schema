<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/loreai) -->
## Long-term Knowledge

For long-term knowledge entries managed by [lore](https://github.com/BYK/loreai) (gotchas, patterns, decisions, architecture), see [`.lore.md`](.lore.md) in the project root.
<!-- End lore-managed section -->

## Toolchain

Use pnpm and Node.js (22.13 or later); do not add Bun-only APIs or tooling. Run `pnpm build` before `pnpm typecheck` and `pnpm test`: both read the generated `src/` and `dist/` output.

## Generated TypeScript

Build generated `.ts` modules from TypeScript compiler nodes (`ts.factory`) and write them with `writeSource` from `lib/generated-source.mjs`. Do not write TypeScript from strings, templates, or `.join()`, and do not patch it with `replaceOnce`. `pnpm lint` enforces this with the `sentry-api/no-typescript-source-strings` rule in `lint/plugin.mjs`. The generators that predate the rule are listed in `.oxlintrc.json`; take a file off that list when you move it to the printer, and do not add new ones.

## URLs

Parse URLs with `URL` (`new URL`, `URL.canParse`), never with regular expressions. `test/url-parsing.test.ts` fails on any regex that matches a scheme separator (`://`).

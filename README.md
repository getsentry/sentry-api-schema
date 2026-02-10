# Sentry API Schema

Sentry's public API schema and auto-generated TypeScript types, published as [`@sentry/api`](https://www.npmjs.com/package/@sentry/api).

## About

This repository contains Sentry's [OpenAPI](https://swagger.io/specification/) v3.0.1 schema and tooling to generate TypeScript types from it. The schema source of truth lives in [getsentry/sentry](https://github.com/getsentry/sentry/tree/master/api-docs) and is synced here automatically.

## Installation

```bash
npm install @sentry/api
```

## Usage

```typescript
import type { ... } from "@sentry/api";
```

## Development

This project uses [Bun](https://bun.sh) as its package manager and build tool.

```bash
# Install dependencies
bun install

# Build the package (generates types from OpenAPI schema, bundles, and emits declarations)
bun run build
```

## License

FSL-1.1-Apache-2.0. See [LICENSE.md](LICENSE.md) for details.

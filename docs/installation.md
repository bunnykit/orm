# Installation

Bunny ORM is a **Bun-only package**. It links directly against `bun:sql`, so it cannot run under Node.js, npm, yarn, or pnpm.

## Requirements

- [Bun](https://bun.sh) `1.1.0` or newer (declared in `engines.bun`).
- A supported database driver — SQLite (bundled with Bun), PostgreSQL, or MySQL.

Verify your Bun version:

```bash
bun --version
```

## Add the package

```bash
bun add @bunnykit/orm
```

That is the entire install step. The package ships with **zero runtime dependencies** — no `pg`, no `mysql2`, no driver layer to wire up. Connections go through `bun:sql`, which Bun provides natively.

## TypeScript

If your project uses TypeScript, no extra `@types/*` packages are needed. The ORM ships full `.d.ts` declarations alongside its JavaScript build in `dist/`. Make sure your `tsconfig.json` includes the standard library settings Bun expects:

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  }
}
```

`bun-types` is included in any `bun init` scaffold.

## The CLI

Installing the package also exposes the `bunny` CLI for migrations, seeders, and the REPL:

```bash
bunx bunny --help
bunx bunny migrate
bunx bunny repl
```

If you want a shorter invocation, add a script alias to `package.json`:

```jsonc
{
  "scripts": {
    "bunny": "bunny"
  }
}
```

Then `bun run bunny migrate` instead of `bunx bunny migrate`.

## Next steps

- [Configuration](./configuration.md) — create `bunny.config.ts` and wire up the connection.
- [Quickstart](./quickstart.md) — define your first model and run a query.

## Troubleshooting

**`Cannot find module 'bun:sql'`** — you are running under Node.js. Switch to `bun run …` instead of `node …` or `npm run …`.

**`bun add` cannot resolve the package** — make sure your registry is set correctly. The package is published on the public npm registry; no private auth is required.

**TypeScript complains about `Bun.SQL`** — install or upgrade `bun-types` (`bun add -d bun-types`) and ensure it is listed in `compilerOptions.types`.

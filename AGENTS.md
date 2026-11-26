# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only. A CommonJS project loads them through `require(esm)`, which needs Node.js 20.19+ or 22.12+, and doesn't have to convert (https://docs.nestjs.com/migration-guide.md).

## Production data: NestJS Observe

This app reports its traces, errors, logs and metrics to [NestJS Observe](https://observe.nestjs.com) through `ObserveModule`, registered first in `src/app.module.ts` (and `instrument: ObserveInstrument` in `src/main.ts` and `src/stdio.ts`). Its key pair comes from `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in `.env`, which `npx @nestjs/observe link` writes.

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## This project

An MCP server for a helpdesk, on `@nestjs/mcp`: tools to search and reply to tickets, tickets as resources, a reply prompt, over Streamable HTTP (`POST /mcp`, as an OAuth resource server) and stdio. It is the finished app of https://docs.nestjs.com/tutorials/mcp-server, which explains each part; keep the code in step with that page.

- Layout: `src/tickets/` holds the MCP primitives (`tickets.tools.ts`: `@Tool()`, `@ResourceTemplate()`, `@Prompt()` methods of one provider), the queries (`tickets.service.ts`) and `@CurrentAgent()`. `src/auth/` holds the token verifier. `McpModule.forRootAsync()` in `src/app.module.ts` serves the modules in its `include`: a new module with tools goes there, and in `imports`. The environment is the Zod schema in `src/config.ts`: add a variable there, and to `.env.example`.
- Two entry points share `AppModule`: `src/main.ts` (HTTP) and `src/stdio.ts` (stdio). `ObserveModule.forRoot()` stays first in `AppModule`'s imports, and both entry points pass `instrument: ObserveInstrument`.
- Tool inputs are Zod schemas on the decorators, with a `.describe()` on each field: the model knows a tool only by its name, description and schema. Keep descriptions and `readOnlyHint` honest. Numbers that reach an `integer` column are capped at 2^31-1, so a large id is a validation error, not a 500. Resource template variables are strings: parse them, and treat a malformed one as not found.
- The caller: `@CurrentAgent()` (after the `(input, ctx)` parameters) gives the team and username. Over HTTP it reads them from the verified token's `authInfo.extra`; over stdio, from `HELPDESK_TEAM` and `USER`. HTTP never falls back to the environment, and a missing or empty team is a 403. Never take the team, or anything that decides access, from a tool's arguments.
- Every `TicketsService` method takes the team and puts it in the SQL statement (`WHERE ... AND team_id = ...`). Another team's ticket is as unknown as a missing one: `NotFoundException`. Writes are one conditional `UPDATE` matched on the ticket and the team, then the `INSERT`, in one transaction.
- Auth: every request needs a token with `tickets:read` (`requiredScopes`); a tool that writes declares `scopes: ['tickets:write']`. `AccessTokenVerifier` is provider-agnostic: issuer, JWKS, audience, `typ` and the team claim all come from config. Over stdio there is no token and scopes aren't checked.
- stdout is the stdio transport's channel: nothing in `src/` writes to it. `src/stdio.ts` uses `McpStdioLogger`, which sends every log line to stderr; don't use `console.log` in code the stdio server runs.
- `scripts/dev-issuer.ts` mints tokens for anyone who asks. It stays outside `src/` (the build doesn't compile it), refuses `NODE_ENV=production` and binds 127.0.0.1. Never import it from `src/` or deploy it. The tests use its `DevIssuer` class.
- Migrations: change `src/database/schema.ts`, run `npm run db:generate`, and commit the folder it writes in `drizzle/`. `npm run db:migrate` applies them. `npm run db:seed` empties the tables: development only.
- Tests: `TEST_DATABASE_URL=postgres://postgres:helpdesk@localhost:5432/helpdesk_test npm run test:e2e`, with a `.env` (copied from `.env.example`) for the stdio tests; without `TEST_DATABASE_URL` they are skipped. The script builds first. `test/helpdesk.e2e-spec.ts` protects team scoping (search, resource, prompt and reply never reach another team's ticket), the `tickets:write` scope, argument validation, and over HTTP the 401 challenge, the audience, issuer, expiry, signature and `typ` checks, and the Origin and Host checks. `test/stdio.e2e-spec.ts` launches `dist/stdio.js` and protects stdio team scoping and a stdout that carries nothing but protocol messages.

This project is ESM: relative imports end in `.js`, and `__dirname` doesn't exist (use `import.meta.dirname`).

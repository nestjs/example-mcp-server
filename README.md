# Build an MCP server in Node.js with NestJS

This is the finished application of the tutorial [Build an MCP server in Node.js](https://docs.nestjs.com/tutorials/mcp-server) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

## What it does

An MCP server for a helpdesk, built with [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview), that lets a support team's AI assistant work with tickets:

- Two tools: `search-tickets` (read-only) and `reply-to-ticket`, with Zod schemas written for the model and validation errors it can read.
- Each ticket as a resource, `tickets://{ticketId}`, with its whole thread, and a `draft-reply` prompt that embeds the ticket.
- Streamable HTTP at `POST /mcp`, as an OAuth 2.1 resource server: it accepts only JWT access tokens issued for it (issuer, audience, `typ: at+jwt`, signature checked against the provider's JWKS), and answers a request without one with a 401 that points at its protected resource metadata.
- Every query scoped to the team named in the token: an agent of one team never reads or changes another team's tickets, whatever the model asks for. Replying needs the `tickets:write` scope.
- Requests from web pages on other sites, or with a `Host` it doesn't answer to, get 403.
- The same tools over stdio (`node dist/stdio.js`), for an assistant that launches the server locally, with the team taken from `HELPDESK_TEAM`.
- Tickets, replies and teams in PostgreSQL through Drizzle; every call reported to NestJS Observe once it has a key pair.

There is no identity provider here. `scripts/dev-issuer.ts` stands in for one on your machine: it holds a key pair, serves its public key as a JWKS, and signs access tokens for any agent, team and scopes you ask for. The tests use it too.

> **Warning:** the development issuer gives a token to anyone who asks. It is for local use only: never deploy it. It refuses to start with `NODE_ENV=production`, listens on the loopback interface only, and lives in `scripts/`, which the build doesn't compile. It is not an authorization server either: it has no sign-in page, so clients that sign users in through OAuth can't use it.

## Run it

You need Node.js 22.18 or later (the development issuer runs TypeScript directly), and Docker for PostgreSQL.

```bash
git clone https://github.com/nestjs/example-mcp-server.git
cd example-mcp-server
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run build
npm run db:seed        # two teams, four tickets; it empties the tables first
```

Start the development issuer in one terminal. It serves its keys at http://localhost:3001/jwks.json and tokens at `POST http://localhost:3001/token`:

```bash
npm run dev:issuer
```

Start the server in another:

```bash
npm run start
```

The MCP endpoint is http://localhost:3000/mcp. Get a token for Ada, of the billing team, and search her team's tickets:

```bash
TOKEN=$(curl -s localhost:3001/token -d username=ada -d team=billing -d 'scope=tickets:read tickets:write' | jq -r .access_token)
curl localhost:3000/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search-tickets","arguments":{"text":"refund"}}}'
```

The tutorial's [Try it](https://docs.nestjs.com/tutorials/mcp-server#try-it) section goes further with `curl` and the MCP Inspector: the 401 challenge, reading a ticket, replying, another team's agent, a read-only token. [Connect an assistant](https://docs.nestjs.com/tutorials/mcp-server#connect-an-assistant) shows how to add the server to Claude Code, Cursor, VS Code and other clients, over HTTP with the token as a header, or as a stdio command:

```json
{
  "mcpServers": {
    "helpdesk": {
      "command": "node",
      "args": ["/path/to/example-mcp-server/dist/stdio.js"],
      "env": { "HELPDESK_TEAM": "billing" }
    }
  }
}
```

Use `node` with the built file's absolute path, not `npm run`, which prints its own lines to stdout, the protocol's channel. The rest of the configuration comes from the project's `.env`.

## A real identity provider

In production, point the configuration at your identity provider instead of the development issuer (see [Use a real identity provider](https://docs.nestjs.com/tutorials/mcp-server#use-a-real-identity-provider)):

- `MCP_RESOURCE`: the server's public `https` URL, such as `https://helpdesk.example.com/mcp`. Create an API in the provider whose identifier is this URL, with the scopes `tickets:read` and `tickets:write`, and a claim for the team.
- `OIDC_ISSUER`: the exact `iss` of the provider's access tokens.
- `OIDC_JWKS_URL`: the `jwks_uri` of its `/.well-known/openid-configuration` document.
- `OIDC_AUDIENCE`: the tokens' `aud`, only when the provider can't make it `MCP_RESOURCE` (Entra ID puts the API's client ID there).
- `OIDC_TOKEN_TYPE`: the `typ` header of its access tokens, `at+jwt` by default; set it empty for a provider that sends none (Entra ID, Okta).
- `OIDC_TEAM_CLAIM`: the claim that names the agent's team, `team` by default.
- `MCP_ALLOWED_HOSTS`: the hostnames clients reach the server by.

The tutorial has a table of the differences between Auth0, Microsoft Entra ID, Okta and WorkOS AuthKit. It summarizes each provider's documentation and wasn't run against them: decode one access token from your provider and compare it with the configuration before you deploy. With a real provider, most MCP clients sign the user in themselves, from the 401 and the metadata.

## Operations

| Operation | Section |
| --- | --- |
| Tools `search-tickets` and `reply-to-ticket` | [Write tools for the model](https://docs.nestjs.com/tutorials/mcp-server#write-tools-for-the-model) |
| Resource template `tickets://{ticketId}`, prompt `draft-reply` | [Serve tickets as resources](https://docs.nestjs.com/tutorials/mcp-server#serve-tickets-as-resources) |
| `POST /mcp`, `GET /.well-known/oauth-protected-resource/mcp` | [Verify OAuth access tokens](https://docs.nestjs.com/tutorials/mcp-server#verify-oauth-access-tokens) |
| `node dist/stdio.js` | [Serve the same tools over stdio](https://docs.nestjs.com/tutorials/mcp-server#serve-the-same-tools-over-stdio) |
| `GET /jwks.json`, `POST /token` on the development issuer | [Get a token for development](https://docs.nestjs.com/tutorials/mcp-server#get-a-token-for-development) |

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | the HTTP server on the Node adapter: JSON logs in production, security headers, shutdown hooks |
| `src/stdio.ts` | the stdio server, from an application context, with every log line on stderr |
| `src/app.module.ts` | NestJS Observe, config, database, and `McpModule` with its HTTP and auth options |
| `src/config.ts` | the environment's schema, checked at startup |
| `src/database/` | the Drizzle tables (`schema.ts`) and the development seed (`seed.ts`) |
| `src/auth/` | `AccessTokenVerifier`: verifies the provider's access tokens and reads the scopes and the team |
| `src/tickets/` | the tools, resource template and prompt (`tickets.tools.ts`), the team-scoped queries (`tickets.service.ts`), and `@CurrentAgent()` |
| `scripts/dev-issuer.ts` | the development issuer, for your machine and the tests only |
| `test/` | e2e tests on PostgreSQL: in memory, over HTTP, and over stdio |
| `drizzle/` | migrations |

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:helpdesk@localhost:5432/helpdesk_test npm run test:e2e
```

`docker compose` creates the `helpdesk_test` database. The tests truncate its tables, so never point them at your development database. The script builds first, because the stdio tests launch `dist/stdio.js`, which reads the rest of its configuration from `.env`: copy `.env.example` to `.env` before running them. They serve the development issuer's keys on 127.0.0.1:3162 and the application on 127.0.0.1:3163.

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview) on the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Zod](https://zod.dev), [`@nestjs/config`](https://docs.nestjs.com/application/configuration), `JwtVerifier` from [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## Production

Read the tutorial's production checklist first: https://docs.nestjs.com/tutorials/mcp-server#production-checklist. Never deploy the development issuer, or a token endpoint like it.

NestJS Observe is wired in `src/app.module.ts` and sends nothing until it has a key pair. `npx @nestjs/observe link` writes the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) into `.env`; in production, set them in the platform's environment, since `start:prod` doesn't load `.env`. Observe then records each MCP call under its operation, such as `tools/call search-tickets`: https://docs.nestjs.com/observability/overview. For the stdio server, add the key pair to the client's `env`, since the SDK reads it before `.env` is loaded.

## License

MIT

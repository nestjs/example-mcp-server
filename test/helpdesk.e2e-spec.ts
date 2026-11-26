import { request as httpRequest, type Server } from 'node:http';
import {
  Client,
  InsufficientScopeError,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { getDrizzleToken } from '@nestjs/drizzle';
import { connectMcpClient } from '@nestjs/mcp/testing';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { DevIssuer, type DevTokenClaims } from '../scripts/dev-issuer.js';
import { AppModule } from '../src/app.module.js';
import { replies, tickets } from '../src/database/schema.js';
import { resetDatabase } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const PORT = 3163;

// Stands in for the identity provider: its keys, served as the JWKS that OIDC_JWKS_URL names.
const issuer = new DevIssuer(process.env.OIDC_ISSUER!, process.env.MCP_RESOURCE!);

describe.skipIf(!url)('Helpdesk MCP server (e2e)', () => {
  const pool = new Pool({ connectionString: url });
  let fixtures: Awaited<ReturnType<typeof resetDatabase>>;
  let jwks: Server;
  let app: NestNodeApplication;

  beforeAll(async () => {
    jwks = await issuer.listen(Number(new URL(process.env.OIDC_JWKS_URL!).port));
    fixtures = await resetDatabase(pool);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(fixtures.db)
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    // Listening, for the tests over HTTP; the in-memory client needs no socket.
    await app.listen(PORT, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close(); // closes the pool too
    jwks.close();
  });

  /** An in-memory MCP client, signed in as an agent of `team` with `scope`. */
  async function as<T>(claims: DevTokenClaims, run: (client: Client) => Promise<T>): Promise<T> {
    const client = await connectMcpClient(app, { token: issuer.sign(claims) });
    try {
      return await run(client);
    } finally {
      await client.close();
    }
  }
  const billing = { username: 'ada', team: 'billing' };
  const textOf = (result: { content?: unknown }) => (result.content as { text: string }[])[0].text;

  it('lists the tools, with the search marked read-only', async () => {
    const { tools } = await as(billing, (client) => client.listTools());
    expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
      ['search-tickets', true],
      ['reply-to-ticket', undefined],
    ]);
  });

  it("finds only the agent's own team's tickets", async () => {
    const found = await as(billing, (client) => client.callTool({ name: 'search-tickets', arguments: {} }));
    expect(JSON.parse(textOf(found)).map((ticket: { id: number }) => ticket.id)).toEqual([fixtures.billingTicket]);
  });

  it("never reads or changes another team's ticket", async () => {
    const other = fixtures.shippingTicket;
    await as(billing, async (client) => {
      await expect(client.readResource({ uri: `tickets://${other}` })).rejects.toThrow(`Resource not found: tickets://${other}`);
      await expect(
        client.getPrompt({ name: 'draft-reply', arguments: { ticketId: String(other) } }),
      ).rejects.toThrow(`Ticket ${other} not found`);
      const reply = await client.callTool({
        name: 'reply-to-ticket',
        arguments: { ticketId: other, message: 'Hello from billing', status: 'solved' },
      });
      expect(reply).toMatchObject({ isError: true, content: [{ type: 'text', text: `Ticket ${other} not found` }] });
    });
    const [ticket] = await fixtures.db.select().from(tickets).where(eq(tickets.id, other));
    expect(ticket.status).toBe('open');
    expect(await fixtures.db.$count(replies, eq(replies.ticketId, other))).toBe(0);
  });

  it('replies, sets the status, and shows the reply in the ticket', async () => {
    const id = fixtures.billingTicket;
    await as(billing, async (client) => {
      const reply = await client.callTool({
        name: 'reply-to-ticket',
        arguments: { ticketId: id, message: 'Refunded the second charge.', status: 'solved' },
      });
      expect(reply.structuredContent).toEqual({ ticketId: id, replyId: expect.any(Number), status: 'solved' });

      const { contents } = await client.readResource({ uri: `tickets://${id}` });
      const ticket = JSON.parse((contents[0] as { text: string }).text);
      expect(ticket).toMatchObject({ id, status: 'solved', replies: [{ author: 'ada', body: 'Refunded the second charge.' }] });
    });
  });

  it('asks for tickets:write before a reply, and changes nothing without it', async () => {
    const id = fixtures.billingTicket;
    const before = await fixtures.db.$count(replies, eq(replies.ticketId, id));
    await as({ ...billing, scope: 'tickets:read' }, async (client) => {
      const search = await client.callTool({ name: 'search-tickets', arguments: { text: 'charged' } });
      expect(search.isError).toBeFalsy();
      const error = await client
        .callTool({ name: 'reply-to-ticket', arguments: { ticketId: id, message: 'Hi' } })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InsufficientScopeError);
      expect(error).toMatchObject({ requiredScope: 'tickets:write' });
    });
    expect(await fixtures.db.$count(replies, eq(replies.ticketId, id))).toBe(before);
  });

  it('tells the model what is wrong with its arguments', async () => {
    await as(billing, async (client) => {
      for (const args of [{ ticketId: '1001', message: 'Hi' }, { ticketId: 2 ** 31, message: 'Hi' }, { ticketId: 1001, message: ' ' }]) {
        const result = await client.callTool({ name: 'reply-to-ticket', arguments: args });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/^Input validation error/);
      }
    });
  });

  describe('over HTTP', () => {
    const endpoint = `http://127.0.0.1:${PORT}/mcp`;
    const listTools = (headers: Record<string, string> = {}) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

    it('challenges a request without a token, pointing at the metadata', async () => {
      const response = await listTools();
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain(
        'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
      );
      const metadata = await fetch(`http://127.0.0.1:${PORT}/.well-known/oauth-protected-resource/mcp`);
      expect(await metadata.json()).toMatchObject({
        resource: 'http://localhost:3000/mcp',
        authorization_servers: ['https://idp.test'],
        scopes_supported: ['tickets:read', 'tickets:write'],
      });
    });

    it('refuses tokens for another audience, expired, wrongly signed or of another type with 401', async () => {
      const impostor = new DevIssuer(issuer.issuer, issuer.audience); // same kid, another key
      const tokens = {
        'another audience': issuer.sign(billing, { audience: 'https://other-api.example/mcp' }),
        'another issuer': issuer.sign(billing, { issuer: 'https://evil.example' }),
        expired: issuer.sign(billing, { now: () => Date.now() - 2 * 60 * 60 * 1000 }),
        'wrongly signed': impostor.sign(billing),
        'an ID token': issuer.sign(billing, { type: 'JWT' }),
      };
      for (const [reason, token] of Object.entries(tokens)) {
        const response = await listTools({ authorization: `Bearer ${token}` });
        expect(response.status, reason).toBe(401);
        expect(response.headers.get('www-authenticate'), reason).toContain('error="invalid_token"');
      }
      expect((await listTools({ authorization: `Bearer ${issuer.sign(billing)}` })).status).toBe(200);
    });

    it('refuses a page from another site, and a Host it does not answer to', async () => {
      const token = issuer.sign(billing);
      expect((await listTools({ authorization: `Bearer ${token}`, origin: 'https://elsewhere.example' })).status).toBe(403);
      // fetch() sets Host itself, so this one goes through node:http.
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(endpoint, {
          method: 'POST',
          headers: {
            host: 'attacker.example:3000',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
        });
        req.on('response', (res) => resolve(res.statusCode!)).on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
      });
      expect(status).toBe(403);
    });

    it('serves the SDK client with a bearer token', async () => {
      const client = new Client({ name: 'helpdesk-e2e', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { authorization: `Bearer ${issuer.sign(billing)}` } },
        }),
      );
      try {
        const result = await client.callTool({ name: 'search-tickets', arguments: { text: 'charged' } });
        expect(JSON.parse(textOf(result))).toMatchObject([{ id: fixtures.billingTicket }]);
      } finally {
        await client.close();
      }
    });
  });
});

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Pool } from 'pg';
import { resetDatabase } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const stdioJs = fileURLToPath(new URL('../dist/stdio.js', import.meta.url));

describe.skipIf(!url)('stdio entry point (e2e)', () => {
  it('serves the tools to a client that launches it, for the team in its environment', async () => {
    const pool = new Pool({ connectionString: url });
    const { billingTicket } = await resetDatabase(pool);
    await pool.end();

    // What a desktop client runs: node, the built stdio.js, and the env of its configuration.
    // The rest of the configuration comes from the project's .env; DATABASE_URL points at the test database.
    const client = new Client({ name: 'stdio-e2e', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({ command: 'node', args: [stdioJs], env: { HELPDESK_TEAM: 'billing', DATABASE_URL: url! } }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['search-tickets', 'reply-to-ticket']);
      const found = await client.callTool({ name: 'search-tickets', arguments: {} });
      const ids = JSON.parse((found.content as { text: string }[])[0].text).map((ticket: { id: number }) => ticket.id);
      expect(ids).toEqual([billingTicket]);
    } finally {
      await client.close();
    }
  });

  it('writes nothing but protocol messages to stdout, from start to exit', async () => {
    // The SDK's client skips stdout lines that aren't JSON; other clients don't. So read stdout raw.
    const server = spawn('node', [stdioJs], { env: { ...process.env, HELPDESK_TEAM: 'billing', DATABASE_URL: url } });
    let stdout = '';
    let stderr = '';
    server.stderr.on('data', (chunk) => (stderr += chunk));
    server.stdout.on('data', (chunk) => {
      stdout += chunk;
      // The answer is in: close stdin, as a client does when it quits.
      if (stdout.includes('\n')) server.stdin.end();
    });
    const initialize = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1.0.0' } };
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initialize })}\n`);
    await new Promise((resolve) => server.on('exit', resolve));

    expect(stdout.trim().split('\n').map((line) => JSON.parse(line).id)).toEqual([1]);
    // The logs went to stderr, Observe's warning about its missing key pair included.
    expect(stderr).toContain('Starting Nest application');
    expect(stderr).toContain('Observe is installed but sends nothing');
  });
});

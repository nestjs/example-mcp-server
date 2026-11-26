import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // The files share one database, and each empties it first.
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgres://unused-in-tests',
      MCP_RESOURCE: 'http://localhost:3000/mcp',
      OIDC_ISSUER: 'https://idp.test',
      // The key set test/helpdesk.e2e-spec.ts serves, from the dev issuer.
      OIDC_JWKS_URL: 'http://127.0.0.1:3162/jwks.json',
    },
  },
});

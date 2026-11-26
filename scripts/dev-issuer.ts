/**
 * A stand-in for an identity provider, for development and tests only: a key pair of its own, its
 * public key served as a JWKS, and access tokens signed with it for whatever team and scopes you ask.
 * Never deploy it: whoever can reach it can mint a token.
 */
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { JwtSigner, type Duration } from '@nestjs/authentication';

export type DevTokenClaims = { username?: string; team?: string; scope?: string };
export type DevTokenOptions = { issuer?: string; audience?: string; ttl?: Duration; type?: string; now?: () => number };

const KID = 'dev-key';

export class DevIssuer {
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly issuer: string;
  readonly audience: string;

  constructor(issuer: string, audience: string) {
    this.issuer = issuer;
    this.audience = audience;
  }

  /** An RFC 9068 access token, as an authorization server issues one for the MCP server. */
  sign(
    { username = 'ada', team = 'billing', scope = 'tickets:read tickets:write' }: DevTokenClaims = {},
    { issuer = this.issuer, audience = this.audience, ttl = '1h', type = 'at+jwt', now = Date.now }: DevTokenOptions = {},
  ): string {
    const signer = new JwtSigner({ key: this.keys.privateKey, kid: KID, issuer, audience, ttl, type, now });
    return signer.sign({ sub: username, preferred_username: username, client_id: 'dev-issuer', scope, team });
  }

  jwks() {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    return { keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] };
  }

  /** Serves the JWKS, and `POST /token` with a form of `username`, `team` and `scope`. */
  listen(port: number): Promise<Server> {
    const server = createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/jwks.json') {
        res.end(JSON.stringify(this.jwks()));
      } else if (req.method === 'POST' && req.url === '/token') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = Object.fromEntries(new URLSearchParams(body));
        const accessToken = this.sign(form);
        res.end(JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600 }));
      } else {
        res.statusCode = 404;
        res.end('{"error":"not_found"}');
      }
    });
    // Loopback only: nothing outside this machine can ask it for a token.
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
  }
}

// `npm run dev:issuer`: serves at the port of OIDC_JWKS_URL, as the issuer and for the audience in .env.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The dev issuer mints tokens for anyone who asks: never run it in production');
  }
  const { OIDC_ISSUER, OIDC_JWKS_URL, MCP_RESOURCE } = process.env;
  if (!OIDC_ISSUER || !OIDC_JWKS_URL || !MCP_RESOURCE) {
    throw new Error('Set OIDC_ISSUER, OIDC_JWKS_URL and MCP_RESOURCE in .env');
  }
  const port = Number(new URL(OIDC_JWKS_URL).port);
  await new DevIssuer(OIDC_ISSUER, MCP_RESOURCE).listen(port);
  console.log(`Dev issuer ${OIDC_ISSUER}: keys at ${OIDC_JWKS_URL}, tokens from POST http://localhost:${port}/token`);
}

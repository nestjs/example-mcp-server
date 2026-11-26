import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtVerifier, type JwtClaims } from '@nestjs/authentication';
import type { McpTokenVerifier } from '@nestjs/mcp';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Env } from '../config.js';

/** Verifies the identity provider's JWT access tokens, and reads what the tools need from them. */
@Injectable()
export class AccessTokenVerifier implements McpTokenVerifier {
  private readonly jwt: JwtVerifier;
  private readonly resource: URL;
  private readonly teamClaim: string;

  constructor(config: ConfigService<Env, true>) {
    this.resource = new URL(config.get('MCP_RESOURCE', { infer: true }));
    this.teamClaim = config.get('OIDC_TEAM_CLAIM', { infer: true });
    this.jwt = new JwtVerifier({
      jwks: config.get('OIDC_JWKS_URL', { infer: true }),
      issuer: config.get('OIDC_ISSUER', { infer: true }),
      // Only tokens issued for this server: not one the user's browser got for another API.
      audience: config.get('OIDC_AUDIENCE', { infer: true }) ?? config.get('MCP_RESOURCE', { infer: true }),
      // An access token, not an ID token or another JWT the provider signs.
      type: config.get('OIDC_TOKEN_TYPE', { infer: true }) || undefined,
      required: ['exp', 'sub'],
      // The provider's clock and this server's are never quite the same.
      clockTolerance: '30s',
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // A bad signature, another issuer or audience, or an expired token throws a JwtError: a 401.
    const claims = await this.jwt.verify(token);
    const team = claims[this.teamClaim];
    return {
      token,
      // The OAuth client the token was issued to: the assistant, not the agent.
      clientId: String(claims.azp ?? claims.client_id ?? claims.sub),
      scopes: scopesOf(claims),
      expiresAt: claims.exp,
      resource: this.resource,
      extra: {
        subject: claims.sub,
        username: typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.sub,
        team: typeof team === 'string' ? team : undefined,
      },
    };
  }
}

/** `scope` is a space-separated string (RFC 9068); some providers send `scp`, as a string or a list. */
function scopesOf(claims: JwtClaims): string[] {
  const value = claims.scope ?? claims.scp;
  const scopes = Array.isArray(value) ? value : typeof value === 'string' ? value.split(' ') : [];
  return scopes.filter((scope): scope is string => typeof scope === 'string' && scope.length > 0);
}

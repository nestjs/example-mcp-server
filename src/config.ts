import { z } from 'zod';

const list = z
  .string()
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  // The MCP server's public URL: the audience of its access tokens.
  MCP_RESOURCE: z.url(),
  // The identity provider's issuer, exactly as the tokens' `iss` claim names it.
  OIDC_ISSUER: z.url(),
  // Its signing keys: `jwks_uri` in its /.well-known/openid-configuration.
  OIDC_JWKS_URL: z.url(),
  // The tokens' `aud`, when the provider can't make it MCP_RESOURCE (Entra ID puts the API's client ID there).
  OIDC_AUDIENCE: z.string().min(1).optional(),
  // The `typ` header its access tokens carry: `at+jwt` (RFC 9068). Empty for a provider that sends none.
  OIDC_TOKEN_TYPE: z.string().default('at+jwt'),
  // The claim that names the agent's team.
  OIDC_TEAM_CLAIM: z.string().min(1).default('team'),
  // The hostnames the Host header may name, comma-separated.
  MCP_ALLOWED_HOSTS: list.default(['localhost', '127.0.0.1', '[::1]']),
  // Over stdio there is no token: the team the local user works in.
  HELPDESK_TEAM: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

export type Env = z.infer<typeof envSchema>;

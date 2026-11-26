import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { McpModule } from '@nestjs/mcp';
import { createObserveModule } from '@nestjs/observe';
import { drizzle } from 'drizzle-orm/node-postgres';
import { fileURLToPath } from 'node:url';
import { AccessTokenVerifier } from './auth/access-token.verifier.js';
import { AuthModule } from './auth/auth.module.js';
import { envSchema, type Env } from './config.js';
import { TicketsModule } from './tickets/tickets.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // First, so it shuts down last and still sends what the other modules did.
    ObserveModule.forRoot({
      // Empty until `npx @nestjs/observe link` writes the key pair into .env: the SDK then sends nothing.
      appKey: process.env.OBSERVE_APP_KEY ?? '',
      appSecret: process.env.OBSERVE_APP_SECRET ?? '',
      serviceId: 'helpdesk-mcp',
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      // The project's .env, whichever directory a local client starts the stdio server in.
      envFilePath: fileURLToPath(new URL('../.env', import.meta.url)),
    }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get('DATABASE_URL', { infer: true }),
      }),
    }),
    McpModule.forRootAsync({
      imports: [AuthModule],
      inject: [ConfigService, AccessTokenVerifier],
      useFactory: (config: ConfigService<Env, true>, verifier: AccessTokenVerifier) => ({
        name: 'helpdesk',
        version: '1.0.0',
        instructions:
          "The support team's helpdesk. Find tickets with search-tickets, read one with its thread as tickets://{ticketId}, and reply with reply-to-ticket only after the user approved the text.",
        include: [TicketsModule],
        http: { allowedHosts: config.get('MCP_ALLOWED_HOSTS', { infer: true }) },
        auth: {
          verifier,
          resource: config.get('MCP_RESOURCE', { infer: true }),
          authorizationServers: [config.get('OIDC_ISSUER', { infer: true })],
          scopesSupported: ['tickets:read', 'tickets:write'],
          // Every request, from the first, needs the read scope.
          requiredScopes: ['tickets:read'],
          resourceName: 'Helpdesk',
        },
      }),
    }),
    TicketsModule,
  ],
})
export class AppModule {}

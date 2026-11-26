import { createParamDecorator, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { McpExecutionContext } from '@nestjs/mcp';

/** Who is calling: the support agent's team, and the name their replies are signed with. */
export interface Agent {
  team: string;
  username: string;
}

/**
 * The agent a call is made for. Over HTTP, from the verified access token; over stdio, where there is
 * no token, from the environment the local client starts the server with.
 */
export const CurrentAgent = createParamDecorator((_data: unknown, context: ExecutionContext): Agent => {
  const ctx = McpExecutionContext.create(context).getContext();
  const agent =
    ctx.transport === 'stdio'
      ? { team: process.env.HELPDESK_TEAM, username: process.env.USER ?? 'local' }
      : { team: ctx.authInfo?.extra?.team, username: ctx.authInfo?.extra?.username };
  if (typeof agent.team !== 'string' || !agent.team || typeof agent.username !== 'string') {
    // The token is valid, but grants no team's tickets.
    throw new ForbiddenException(
      ctx.transport === 'stdio' ? 'Set HELPDESK_TEAM to the team to work in' : 'The access token names no team',
    );
  }
  return { team: agent.team, username: agent.username };
});

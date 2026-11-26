import { Injectable, NotFoundException } from '@nestjs/common';
import { Prompt, ResourceTemplate, Tool, type McpContext } from '@nestjs/mcp';
import type { PromptMessage } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CurrentAgent, type Agent } from './agent.decorator.js';
import { TicketsService } from './tickets.service.js';

// The database's integer range: a larger number would be a 500, not a validation error.
const ticketId = z.number().int().min(1).max(2_147_483_647).describe('The ticket number, such as 1042');
const status = z.enum(['open', 'pending', 'solved']);

const searchTicketsSchema = z.object({
  text: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .optional()
    .describe('Words to find in the subject or the description, such as "refund" or an order number'),
  status: status.optional().describe('Only tickets in this status. Leave it out to search all of them'),
  limit: z.number().int().min(1).max(50).default(10).describe('How many tickets to return, newest first'),
});

const replyToTicketSchema = z.object({
  ticketId,
  message: z
    .string()
    .trim()
    .min(1)
    .max(5000)
    .describe('The reply as the customer will read it, in plain text'),
  status: z
    .enum(['pending', 'solved'])
    .optional()
    .describe('"pending" when you asked the customer something, "solved" when nothing is left to do. Leave it out to keep the status'),
});

@Injectable()
export class TicketsTools {
  constructor(private readonly tickets: TicketsService) {}

  @Tool({
    name: 'search-tickets',
    description:
      "Search the support team's tickets by text and status. Returns each ticket's number, subject, status and customer, newest first; read a ticket's full thread as the resource tickets://{ticketId}",
    inputSchema: searchTicketsSchema,
    annotations: { readOnlyHint: true },
  })
  search(input: z.infer<typeof searchTicketsSchema>, _ctx: McpContext, @CurrentAgent() agent: Agent) {
    return this.tickets.search(agent.team, input);
  }

  @Tool({
    name: 'reply-to-ticket',
    description:
      "Reply to a ticket's customer, and optionally change the ticket's status. The customer reads the reply: only call it with text the user has approved",
    inputSchema: replyToTicketSchema,
    outputSchema: z.object({ ticketId: z.number().int(), replyId: z.number().int(), status }),
    // It adds to a ticket and removes nothing, but a retry adds a second reply.
    annotations: { destructiveHint: false, idempotentHint: false },
    scopes: ['tickets:write'],
  })
  reply(
    { ticketId, message, status }: z.infer<typeof replyToTicketSchema>,
    _ctx: McpContext,
    @CurrentAgent() agent: Agent,
  ) {
    return this.tickets.reply(agent.team, ticketId, agent.username, message, status);
  }

  @ResourceTemplate({
    uriTemplate: 'tickets://{ticketId}',
    name: 'ticket',
    description: 'A ticket with its whole thread: the description, then every reply, oldest first',
    mimeType: 'application/json',
  })
  ticket({ ticketId }: { ticketId: string }, _ctx: McpContext, @CurrentAgent() agent: Agent) {
    return this.tickets.findOne(agent.team, parseTicketId(ticketId));
  }

  @Prompt({
    name: 'draft-reply',
    description: 'Draft a reply to a ticket, for you to review before it is sent',
    argsSchema: z.object({
      ticketId: z.string().regex(/^\d+$/).describe('The ticket number, such as 1042'),
      tone: z.enum(['formal', 'friendly']).default('friendly').describe('How the reply sounds'),
    }),
  })
  async draftReply(
    { ticketId, tone }: { ticketId: string; tone: 'formal' | 'friendly' },
    _ctx: McpContext,
    @CurrentAgent() agent: Agent,
  ): Promise<PromptMessage[]> {
    const ticket = await this.tickets.findOne(agent.team, parseTicketId(ticketId));
    return [
      {
        role: 'user',
        content: {
          type: 'resource',
          resource: { uri: `tickets://${ticket.id}`, mimeType: 'application/json', text: JSON.stringify(ticket) },
        },
      },
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Draft a ${tone} reply to the customer of ticket ${ticket.id}. Answer what they asked last, and say what happens next. Show me the draft; send it with reply-to-ticket only once I approve it.`,
        },
      },
    ];
  }
}

/** A URI's variable is any string: a ticket number, or not found. */
function parseTicketId(value: string): number {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id > 2_147_483_647) {
    throw new NotFoundException(`Ticket ${value} not found`);
  }
  return id;
}

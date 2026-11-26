import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { replies, tickets, type Reply, type Ticket, type TicketStatus } from '../database/schema.js';

export interface SearchTicketsQuery {
  text?: string;
  status?: TicketStatus;
  limit: number;
}

export type TicketSummary = Pick<Ticket, 'id' | 'subject' | 'status' | 'customerEmail' | 'updatedAt'>;
export type TicketWithReplies = Ticket & { replies: Reply[] };

/** Every method takes the agent's team, and never reads or changes another team's tickets. */
@Injectable()
export class TicketsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  search(team: string, { text, status, limit }: SearchTicketsQuery): Promise<TicketSummary[]> {
    const conditions: SQL[] = [eq(tickets.teamId, team)];
    if (text) {
      // The text is matched literally: % and _ in it are not wildcards.
      const pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(or(ilike(tickets.subject, pattern), ilike(tickets.body, pattern))!);
    }
    if (status) {
      conditions.push(eq(tickets.status, status));
    }
    return this.db
      .select({
        id: tickets.id,
        subject: tickets.subject,
        status: tickets.status,
        customerEmail: tickets.customerEmail,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(and(...conditions))
      .orderBy(desc(tickets.updatedAt), desc(tickets.id))
      .limit(limit);
  }

  /** The ticket and its replies, oldest first. Another team's ticket is as unknown as a missing one. */
  async findOne(team: string, id: number): Promise<TicketWithReplies> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.teamId, team)));
    if (!ticket) {
      throw notFound(id);
    }
    const thread = await this.db
      .select()
      .from(replies)
      .where(eq(replies.ticketId, id))
      .orderBy(asc(replies.createdAt), asc(replies.id));
    return { ...ticket, replies: thread };
  }

  /** Adds a reply and, optionally, sets the status: both, or neither. */
  reply(team: string, id: number, author: string, body: string, status?: TicketStatus) {
    return this.db.transaction(async (tx) => {
      // The team is part of the statement that finds the ticket, and the row stays locked until the reply is in.
      const [ticket] = await tx
        .update(tickets)
        .set({ updatedAt: new Date(), ...(status && { status }) })
        .where(and(eq(tickets.id, id), eq(tickets.teamId, team)))
        .returning({ id: tickets.id, status: tickets.status });
      if (!ticket) {
        throw notFound(id);
      }
      const [reply] = await tx
        .insert(replies)
        .values({ ticketId: id, author, body })
        .returning({ id: replies.id });
      return { ticketId: ticket.id, replyId: reply.id, status: ticket.status };
    });
  }
}

function notFound(id: number) {
  return new NotFoundException(`Ticket ${id} not found`);
}

import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const ticketStatus = pgEnum('ticket_status', ['open', 'pending', 'solved']);

export const teams = pgTable('teams', {
  // A slug such as `billing`: the value of the `team` claim in an agent's token.
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const tickets = pgTable(
  'tickets',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ startWith: 1001 }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    customerEmail: text('customer_email').notNull(),
    status: ticketStatus('status').notNull().default('open'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  // Every query starts with the team: a search is a scan of one team's tickets.
  (table) => [index('tickets_team_id_updated_at_idx').on(table.teamId, table.updatedAt)],
);

export const replies = pgTable(
  'replies',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    // The agent who sent it, as their token names them.
    author: text('author').notNull(),
    body: text('body').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [index('replies_ticket_id_idx').on(table.ticketId)],
);

export type Ticket = typeof tickets.$inferSelect;
export type Reply = typeof replies.$inferSelect;
export type TicketStatus = (typeof ticketStatus.enumValues)[number];

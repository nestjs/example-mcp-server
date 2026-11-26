// Development data: two teams and their tickets. It empties the three tables first.
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { envSchema } from '../config.js';
import { replies, teams, tickets } from './schema.js';

const { DATABASE_URL } = envSchema.pick({ DATABASE_URL: true }).parse(process.env);
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle({ client: pool });

try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE replies, tickets, teams RESTART IDENTITY CASCADE`);
    await tx.insert(teams).values([
      { id: 'billing', name: 'Billing' },
      { id: 'shipping', name: 'Shipping' },
    ]);
    const created = await tx
      .insert(tickets)
      .values([
        {
          teamId: 'billing',
          subject: 'Charged twice for order 5521',
          body: 'My card shows two charges of 49.90 for the same order yesterday. Please refund one.',
          customerEmail: 'maria@example.com',
        },
        {
          teamId: 'billing',
          subject: 'Refund for a cancelled subscription',
          body: 'I cancelled on the 3rd but was charged on the 5th. I would like that refunded.',
          customerEmail: 'li@example.com',
          status: 'pending',
        },
        {
          teamId: 'shipping',
          subject: 'Parcel stuck in customs',
          body: 'Tracking for order 5498 has said "held at customs" for six days.',
          customerEmail: 'sam@example.com',
        },
        {
          teamId: 'shipping',
          subject: 'Wrong size delivered',
          body: 'I ordered the jacket in M and got an L. How do I exchange it?',
          customerEmail: 'noor@example.com',
        },
      ])
      .returning({ id: tickets.id });
    await tx.insert(replies).values({
      ticketId: created[1].id,
      author: 'grace',
      body: 'Sorry about that. Which card was charged, and on which date exactly?',
    });
  });
  console.log('Seeded 2 teams, 4 tickets and 1 reply');
} finally {
  await pool.end();
}

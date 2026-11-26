import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { teams, tickets } from '../src/database/schema.js';

/** Migrates the test database, empties it, and adds one ticket for each of two teams. */
export async function resetDatabase(pool: Pool) {
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  await db.execute(sql`TRUNCATE replies, tickets, teams RESTART IDENTITY CASCADE`);
  await db.insert(teams).values([
    { id: 'billing', name: 'Billing' },
    { id: 'shipping', name: 'Shipping' },
  ]);
  const [billing, shipping] = await db
    .insert(tickets)
    .values([
      { teamId: 'billing', subject: 'Charged twice', body: 'Two charges for order 5521', customerEmail: 'maria@example.com' },
      { teamId: 'shipping', subject: 'Parcel stuck in customs', body: 'Order 5498', customerEmail: 'sam@example.com' },
    ])
    .returning({ id: tickets.id });
  return { db, billingTicket: billing.id, shippingTicket: shipping.id };
}

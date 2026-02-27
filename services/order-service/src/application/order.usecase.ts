import { getDb } from '@database';

export async function listOrders() {
  const db = getDb();
  return db.query('SELECT * FROM orders');
}

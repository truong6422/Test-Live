// Chạy migration thủ công: `bun run db:migrate` (server cũng tự migrate khi khởi động).
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MIGRATIONS_DIR } from '../store/pg-store';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Thiếu DATABASE_URL');
  process.exit(1);
}
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
await client.end();
console.log('Migration xong.');

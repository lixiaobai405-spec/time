const { openDatabase } = require('../server/database/sqlite');

async function migrateDatabase({ databasePath }) {
  if (typeof databasePath !== 'string' || !databasePath.trim()) {
    throw new TypeError('DATABASE_PATH is required');
  }
  const database = await openDatabase({ filename: databasePath.trim() });
  await database.close();
}

async function main() {
  try {
    await migrateDatabase({ databasePath: process.env.DATABASE_PATH });
    process.stdout.write('Migrations completed successfully.\n');
  } catch {
    process.stderr.write('Database migration failed.\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { migrateDatabase };

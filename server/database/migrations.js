const migration001 = require('./migrations/001-auth-history');
const migration002 = require('./migrations/002-case-sensitive-usernames');
const migration003 = require('./migrations/003-daily-tracking');

const MIGRATIONS = Object.freeze([migration001, migration002, migration003]);

function validateMigrations(migrations) {
  const versions = new Set();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error('Migration version must be a positive integer');
    }
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    if (!migration.name || typeof migration.up !== 'function') {
      throw new Error(`Invalid migration: ${migration.version}`);
    }
    versions.add(migration.version);
  }
}

async function runMigrations(transaction, migrations = MIGRATIONS) {
  validateMigrations(migrations);
  await transaction.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = await transaction.all('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.version));
  const ordered = [...migrations].sort((left, right) => left.version - right.version);

  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    await migration.up(transaction);
    await transaction.run(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      [migration.version, migration.name, new Date().toISOString()],
    );
  }
}

module.exports = { MIGRATIONS, runMigrations };

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sqlite3 = require('sqlite3');

const { openDatabase } = require('../../server/database/sqlite');
const { createDatabaseBackup } = require('../../scripts/backup-database');

const ROOT = path.resolve(__dirname, '..', '..');

test('package scripts expose migration and database backup CLIs', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.migrate, 'node scripts/migrate.js');
  assert.equal(packageJson.scripts['backup:database'], 'node scripts/backup-database.js');
});

function safeChildEnvironment(databasePath) {
  return {
    DATABASE_PATH: databasePath,
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
  };
}

function openRawDatabase(filename, mode = sqlite3.OPEN_READONLY) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, mode, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function get(database, sql) {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createSourceDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'time-operations-test-'));
  const databasePath = path.join(directory, 'source.sqlite');
  const backupPath = path.join(directory, 'backups', 'time-management-latest.sqlite');
  const database = await openDatabase({ filename: databasePath });
  t.after(async () => {
    await database.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, databasePath, backupPath, database };
}

async function insertFakeUser(database, id, username) {
  await database.run(
    `INSERT INTO users (
      id, username, normalized_username, password_hash, recovery_code_hash,
      recovery_code_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      username,
      username.toLowerCase(),
      'fake-password-hash',
      'fake-recovery-code-hash',
      1,
      '2026-07-21T00:00:00.000Z',
      '2026-07-21T00:00:00.000Z',
    ],
  );
}

test('migration CLI applies versioned migrations and exits successfully', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'time-migrate-cli-test-'));
  const databasePath = path.join(directory, 'migrated.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'migrate.js')],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: safeChildEnvironment(databasePath),
      windowsHide: true,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Migrations completed successfully/);
  const raw = await openRawDatabase(databasePath);
  try {
    assert.deepEqual(await get(raw, 'SELECT version FROM schema_migrations'), { version: 1 });
  } finally {
    await close(raw);
  }
});

test('migration CLI returns non-zero without exposing database internals on failure', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'time-migrate-failure-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'migrate.js')],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: safeChildEnvironment(directory),
      windowsHide: true,
    },
  );

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Database migration failed\.\r?\n$/);
  assert.doesNotMatch(result.stderr, /SQLITE|time-migrate-failure-test|schema_migrations/i);
});

test('backup captures a live WAL database, passes integrity_check and leaves no temp file', async (t) => {
  const fixture = await createSourceDatabase(t);
  await insertFakeUser(
    fixture.database,
    '11111111-1111-4111-8111-111111111111',
    'Backup_User_One',
  );

  await createDatabaseBackup({
    databasePath: fixture.databasePath,
    backupPath: fixture.backupPath,
  });

  const backup = await openRawDatabase(fixture.backupPath);
  try {
    assert.deepEqual(await get(backup, 'PRAGMA integrity_check'), { integrity_check: 'ok' });
    assert.deepEqual(await get(backup, 'SELECT COUNT(*) AS count FROM users'), { count: 1 });
  } finally {
    await close(backup);
  }
  assert.deepEqual(
    fs.readdirSync(path.dirname(fixture.backupPath)).sort(),
    ['time-management-latest.sqlite'],
  );
});

test('successful backup atomically replaces the single latest backup', async (t) => {
  const fixture = await createSourceDatabase(t);
  await insertFakeUser(
    fixture.database,
    '22222222-2222-4222-8222-222222222222',
    'Backup_User_Two',
  );
  await createDatabaseBackup({
    databasePath: fixture.databasePath,
    backupPath: fixture.backupPath,
  });
  await insertFakeUser(
    fixture.database,
    '33333333-3333-4333-8333-333333333333',
    'Backup_User_Three',
  );

  await createDatabaseBackup({
    databasePath: fixture.databasePath,
    backupPath: fixture.backupPath,
  });

  const backup = await openRawDatabase(fixture.backupPath);
  try {
    assert.deepEqual(await get(backup, 'SELECT COUNT(*) AS count FROM users'), { count: 2 });
  } finally {
    await close(backup);
  }
});

test('failed backup preserves the previous verified backup', async (t) => {
  const fixture = await createSourceDatabase(t);
  await insertFakeUser(
    fixture.database,
    '44444444-4444-4444-8444-444444444444',
    'Backup_User_Four',
  );
  await createDatabaseBackup({
    databasePath: fixture.databasePath,
    backupPath: fixture.backupPath,
  });
  const before = fs.readFileSync(fixture.backupPath);

  await assert.rejects(
    createDatabaseBackup({
      databasePath: path.join(fixture.directory, 'missing.sqlite'),
      backupPath: fixture.backupPath,
    }),
  );

  assert.deepEqual(fs.readFileSync(fixture.backupPath), before);
  assert.deepEqual(
    fs.readdirSync(path.dirname(fixture.backupPath)).sort(),
    ['time-management-latest.sqlite'],
  );
});

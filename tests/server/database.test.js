const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sqlite3 = require('sqlite3');

const { openDatabase } = require('../../server/database/sqlite');
const migration001 = require('../../server/database/migrations/001-auth-history');
const migration002 = require('../../server/database/migrations/002-case-sensitive-usernames');
const migration003 = require('../../server/database/migrations/003-daily-tracking');
const { createTestDatabase } = require('../helpers/test-database');

function rawGet(filename, sql) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, (openError) => {
      if (openError) return reject(openError);
      database.get(sql, (queryError, row) => {
        database.close((closeError) => {
          if (queryError) return reject(queryError);
          if (closeError) return reject(closeError);
          resolve(row);
        });
      });
    });
  });
}

test('openDatabase enables required pragmas and applies all migrations once', async (t) => {
  const fixture = await createTestDatabase(t);

  assert.equal((await fixture.database.get('PRAGMA journal_mode')).journal_mode, 'wal');
  assert.equal((await fixture.database.get('PRAGMA foreign_keys')).foreign_keys, 1);
  assert.equal((await fixture.database.get('PRAGMA busy_timeout')).timeout, 5000);
  assert.deepEqual(
    (await fixture.database.all('SELECT version FROM schema_migrations ORDER BY version'))
      .map((row) => row.version),
    [1, 2, 3, 4, 5],
  );

  for (const table of ['users', 'sessions', 'time_management_runs', 'daily_tracking_days']) {
    const row = await fixture.database.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    assert.equal(row.name, table);
  }

  await fixture.close();
  const reopened = await openDatabase({ filename: fixture.filename });
  assert.equal(
    (await reopened.get('SELECT COUNT(*) AS count FROM schema_migrations')).count,
    5,
  );
  await reopened.close();
});

test('daily tracking migration enforces one checklist per user and date', async (t) => {
  const { database } = await createTestDatabase(t);
  const timestamp = '2026-07-23T00:00:00.000Z';
  await database.run(
    `INSERT INTO users (
      id, username, normalized_username, password_hash, recovery_code_hash,
      recovery_code_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['user-daily', 'DailyUser', 'DailyUser', 'password-hash', 'recovery-hash', 1,
      timestamp, timestamp],
  );
  const values = [
    'daily-1',
    'user-daily',
    '2026-07-23',
    '[]',
    '{}',
    '[]',
    1,
    timestamp,
    timestamp,
  ];
  await database.run(
    `INSERT INTO daily_tracking_days (
      id, user_id, tracking_date, tasks_json, tracking_json,
      removed_task_ids_json, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  );

  await assert.rejects(
    database.run(
      `INSERT INTO daily_tracking_days (
        id, user_id, tracking_date, tasks_json, tracking_json,
        removed_task_ids_json, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['daily-2', ...values.slice(1)],
    ),
    /UNIQUE constraint failed/,
  );
});

test('migration 2 preserves the original case of existing usernames', async (t) => {
  const fixture = await createTestDatabase(t, { migrations: [migration001] });
  await fixture.database.run(
    `INSERT INTO users (
      id, username, normalized_username, password_hash, recovery_code_hash,
      recovery_code_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['legacy-user', 'Manager_旧账号', 'manager_旧账号', 'password-hash', 'recovery-hash', 1,
      '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'],
  );
  await fixture.close();

  const migrated = await openDatabase({ filename: fixture.filename });
  try {
    assert.equal(
      (await migrated.get('SELECT normalized_username FROM users WHERE id = ?', ['legacy-user']))
        .normalized_username,
      'Manager_旧账号',
    );
    assert.deepEqual(
      (await migrated.all('SELECT version FROM schema_migrations ORDER BY version'))
        .map((row) => row.version),
      [1, 2, 3, 4, 5],
    );
  } finally {
    await migrated.close();
  }
});

test('transaction rolls back all writes when work rejects', async (t) => {
  const { database } = await createTestDatabase(t);

  await assert.rejects(
    database.transaction(async (transaction) => {
      await transaction.run(
        `INSERT INTO users (
          id, username, normalized_username, password_hash, recovery_code_hash,
          recovery_code_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['user-1', 'Manager', 'manager', 'password-hash', 'recovery-hash', 1,
          '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'],
      );
      throw new Error('rollback marker');
    }),
    /rollback marker/,
  );

  assert.equal((await database.get('SELECT COUNT(*) AS count FROM users')).count, 0);
});

test('migration 004 adds a nullable distribution_json column to time_management_runs', async (t) => {
  const fixture = await createTestDatabase(t);

  const columns = await fixture.database.all('PRAGMA table_info(time_management_runs)');
  const distributionColumn = columns.find((col) => col.name === 'distribution_json');
  assert.ok(distributionColumn, 'distribution_json column should exist');
  assert.equal(distributionColumn.type, 'TEXT');
  assert.equal(distributionColumn.notnull, 0);
});

test('upgrading from migrations 001–003 to 004 preserves old data and leaves distribution_json NULL', async (t) => {
  const oldFixture = await createTestDatabase(t, {
    migrations: [migration001, migration002, migration003],
  });
  await oldFixture.database.run(
    `INSERT INTO users (
      id, username, normalized_username, password_hash, recovery_code_hash,
      recovery_code_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['old-user', 'OldUser', 'OldUser', 'pwd-hash', 'rec-hash', 1,
      '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'],
  );
  const oldRunId = 'old-run-0000-4000-8000-000000000001';
  const oldTasks = JSON.stringify([{ id: 't1', name: '旧任务', source: '今天', due: '待确认', est: '1h' }]);
  await oldFixture.database.run(
    `INSERT INTO time_management_runs (
      id, user_id, client_run_id, title, goals_json, tasks_json, matrix_json,
      report_json, schema_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      oldRunId, 'old-user', 'old-crid-0000-4000-8000-000000000001',
      '旧报告', '{}', oldTasks, '{}', '{}', 1,
      '2026-07-21T08:00:00.000Z', '2026-07-21T08:00:00.000Z',
    ],
  );
  await oldFixture.close();

  const migrated = await openDatabase({ filename: oldFixture.filename });
  try {
    assert.equal(
      (await migrated.get('SELECT COUNT(*) AS count FROM time_management_runs')).count,
      1,
    );
    const row = await migrated.get(
      'SELECT tasks_json, distribution_json, schema_version FROM time_management_runs WHERE id = ?',
      [oldRunId],
    );
    assert.equal(row.tasks_json, oldTasks);
    assert.equal(row.distribution_json, null);
    assert.equal(row.schema_version, 1);

    const versions = (await migrated.all('SELECT version FROM schema_migrations ORDER BY version'))
      .map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4, 5]);

    // Reopen again — migration 004 must not re-execute
    await migrated.close();
    const reopened = await openDatabase({ filename: oldFixture.filename });
    try {
      assert.equal(
        (await reopened.get('SELECT COUNT(*) AS count FROM schema_migrations')).count,
        5,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await migrated.close();
  }
});

test('a broken migration rolls back and prevents openDatabase from returning', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'time-broken-migration-'));
  const filename = path.join(directory, 'broken.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  await assert.rejects(
    openDatabase({
      filename,
      migrations: [{
        version: 1,
        name: 'broken migration',
        async up(transaction) {
          await transaction.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)');
          await transaction.exec('THIS IS NOT VALID SQL');
        },
      }],
    }),
    /SQLITE_ERROR/,
  );

  const row = await rawGet(
    filename,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'",
  );
  assert.equal(row, undefined);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const { createHistoryRepository } = require('../../server/repositories/history-repository');
const { createUserRepository } = require('../../server/repositories/user-repository');
const { historySnapshot } = require('../helpers/history-fixture');
const { createTestDatabase } = require('../helpers/test-database');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function seedUser(database, id, username) {
  const users = createUserRepository({ database });
  await database.transaction((transaction) => users.createUser(transaction, {
    id,
    username,
    passwordHash: 'fake-password-hash',
    recoveryCodeHash: 'fake-recovery-hash',
  }));
}

test('save is idempotent per user and clientRunId without overwriting the original body', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T08:00:00.000Z',
    randomUUID: () => '10000000-0000-4000-8000-000000000001',
  });

  const first = await repository.save({ userId: USER_A, snapshot: historySnapshot() });
  const retry = await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({ title: '重试不应覆盖的标题' }),
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.item.id, first.item.id);
  assert.equal(retry.item.title, historySnapshot().title);
  assert.deepEqual(retry.item.tasks, historySnapshot().tasks);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM time_management_runs')).count, 1);
});

test('all repository operations require a server-supplied userId', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createHistoryRepository({ database });
  const calls = [
    () => repository.save({ snapshot: historySnapshot() }),
    () => repository.list({}),
    () => repository.listTasksCreatedBetween({
      startUtc: '2026-07-22T16:00:00.000Z',
      endUtc: '2026-07-23T16:00:00.000Z',
    }),
    () => repository.getById({ id: '10000000-0000-4000-8000-000000000001' }),
    () => repository.deleteById({ id: '10000000-0000-4000-8000-000000000001' }),
  ];
  for (const call of calls) {
    await assert.rejects(call, (error) => error.code === 'AUTH_REQUIRED');
  }
});

test('daily source query returns only one users histories inside a half-open range', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  await seedUser(database, USER_B, 'History_B');
  let currentTime = '2026-07-22T15:59:59.999Z';
  const ids = [
    '51000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000002',
    '53000000-0000-4000-8000-000000000003',
    '54000000-0000-4000-8000-000000000004',
  ];
  const repository = createHistoryRepository({
    database,
    now: () => currentTime,
    randomUUID: () => ids.shift(),
  });

  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      clientRunId: '91000000-0000-4000-8000-000000000001',
      title: '范围之前',
    }),
  });
  currentTime = '2026-07-22T16:00:00.000Z';
  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      clientRunId: '92000000-0000-4000-8000-000000000002',
      title: '范围之内',
    }),
  });
  currentTime = '2026-07-22T17:00:00.000Z';
  await repository.save({
    userId: USER_B,
    snapshot: historySnapshot({
      clientRunId: '93000000-0000-4000-8000-000000000003',
      title: '其他账号',
    }),
  });
  currentTime = '2026-07-23T16:00:00.000Z';
  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      clientRunId: '94000000-0000-4000-8000-000000000004',
      title: '范围之后',
    }),
  });

  const result = await repository.listTasksCreatedBetween({
    userId: USER_A,
    startUtc: '2026-07-22T16:00:00.000Z',
    endUtc: '2026-07-23T16:00:00.000Z',
  });
  assert.equal(result.historyCount, 1);
  assert.deepEqual(result.tasks, historySnapshot().tasks);
});

test('user A cannot list, read, or delete user B history', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  await seedUser(database, USER_B, 'History_B');
  const repository = createHistoryRepository({
    database,
    randomUUID: () => '20000000-0000-4000-8000-000000000002',
  });
  const saved = await repository.save({ userId: USER_B, snapshot: historySnapshot() });

  assert.deepEqual(await repository.list({ userId: USER_A }), { items: [], nextCursor: null });
  assert.equal(await repository.getById({ userId: USER_A, id: saved.item.id }), null);
  assert.equal(await repository.deleteById({ userId: USER_A, id: saved.item.id }), false);
  assert.notEqual(await repository.getById({ userId: USER_B, id: saved.item.id }), null);
  assert.equal(await repository.deleteById({ userId: USER_B, id: saved.item.id }), true);
  assert.equal(await repository.getById({ userId: USER_B, id: saved.item.id }), null);
});

test('list uses stable descending cursor pagination and returns summaries only', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  const ids = [
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ];
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T08:00:00.000Z',
    randomUUID: () => ids.shift(),
  });
  for (let index = 1; index <= 3; index += 1) {
    await repository.save({
      userId: USER_A,
      snapshot: historySnapshot({
        clientRunId: `90000000-0000-4000-8000-00000000000${index}`,
        title: `历史 ${index}`,
      }),
    });
  }

  const first = await repository.list({ userId: USER_A, limit: 2 });
  assert.deepEqual(first.items.map((item) => item.title), ['历史 3', '历史 2']);
  assert.equal(typeof first.nextCursor, 'string');
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);

  const second = await repository.list({
    userId: USER_A,
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((item) => item.title), ['历史 1']);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
});

test('details reject unknown schema versions and damaged JSON with a stable safe error', async (t) => {
  const { database, filename } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  const repository = createHistoryRepository({
    database,
    randomUUID: () => '40000000-0000-4000-8000-000000000004',
  });
  const saved = await repository.save({ userId: USER_A, snapshot: historySnapshot() });

  await database.run('UPDATE time_management_runs SET schema_version = 2 WHERE id = ?', [saved.item.id]);
  await assert.rejects(
    repository.getById({ userId: USER_A, id: saved.item.id }),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && !error.message.includes(filename)
      && !/SQLITE|SELECT|time_management_runs/i.test(error.message),
  );

  await database.run(
    'UPDATE time_management_runs SET schema_version = 1, report_json = ? WHERE id = ?',
    ['{damaged', saved.item.id],
  );
  await assert.rejects(
    repository.getById({ userId: USER_A, id: saved.item.id }),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && !error.message.includes('{damaged'),
  );
});

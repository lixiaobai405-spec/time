const assert = require('node:assert/strict');
const test = require('node:test');

const { createHistoryRepository } = require('../../server/repositories/history-repository');
const { createUserRepository } = require('../../server/repositories/user-repository');
const { DISTRIBUTION_FIXTURE, historySnapshot } = require('../helpers/history-fixture');
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

  const snapshot = historySnapshot();
  const first = await repository.save({ userId: USER_A, snapshot });
  const retry = await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({ title: '重试不应覆盖的标题' }),
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.item.id, first.item.id);
  assert.equal(retry.item.title, snapshot.title);
  assert.equal(retry.item.tasks[0].due, '待确认');
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
  assert.equal(result.tasks[0].due, '待确认');
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

  await database.run('UPDATE time_management_runs SET schema_version = 3 WHERE id = ?', [saved.item.id]);
  await assert.rejects(
    repository.getById({ userId: USER_A, id: saved.item.id }),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && !error.message.includes(filename)
      && !/SQLITE|SELECT|time_management_runs/i.test(error.message),
  );

  await database.run(
    'UPDATE time_management_runs SET schema_version = 2, report_json = ? WHERE id = ?',
    ['{damaged', saved.item.id],
  );
  await assert.rejects(
    repository.getById({ userId: USER_A, id: saved.item.id }),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && !error.message.includes('{damaged'),
  );
});

test('history save converts a legacy timestamp to date-only storage', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_Date_Only');
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T08:00:00.000Z',
    randomUUID: () => '19000000-0000-4000-8000-000000000009',
  });
  const snapshot = historySnapshot();
  snapshot.tasks[0].due = '2026-07-20 18:00';

  const saved = await repository.save({ userId: USER_A, snapshot });
  const row = await database.get(
    'SELECT tasks_json FROM time_management_runs WHERE id = ?',
    [saved.item.id],
  );

  assert.equal(saved.item.tasks[0].due, '2026-07-20');
  assert.equal(JSON.parse(row.tasks_json)[0].due, '2026-07-20');
});

test('history task source supports an open lower bound without crossing accounts or the exclusive end', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  await seedUser(database, USER_B, 'History_B');
  let currentTime = '2026-07-22T15:59:59.000Z';
  const ids = [
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000003',
    '64000000-0000-4000-8000-000000000004',
  ];
  const repository = createHistoryRepository({
    database,
    now: () => currentTime,
    randomUUID: () => ids.shift(),
  });

  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      clientRunId: '95000000-0000-4000-8000-000000000001',
      title: '无下界之内1',
    }),
  });
  currentTime = '2026-07-23T08:00:00.000Z';
  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      clientRunId: '95000000-0000-4000-8000-000000000002',
      title: '无下界之内2',
    }),
  });
  currentTime = '2026-07-23T12:00:00.000Z';
  await repository.save({
    userId: USER_B,
    snapshot: historySnapshot({
      clientRunId: '95000000-0000-4000-8000-000000000003',
      title: '其他账号',
    }),
  });
  currentTime = '2026-07-23T16:00:00.000Z';
  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      clientRunId: '95000000-0000-4000-8000-000000000004',
      title: '等于上界应排除',
    }),
  });

  const result = await repository.listTasksCreatedBetween({
    userId: USER_A,
    endUtc: '2026-07-23T16:00:00.000Z',
  });
  assert.equal(result.historyCount, 2);
  assert.equal(result.tasks.length, 4);
  assert.equal(result.tasks[0].due, '待确认');
});

test('history task source open lower bound requires endUtc and rejects invalid ranges', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createHistoryRepository({ database });

  await assert.rejects(
    repository.listTasksCreatedBetween({
      userId: USER_A,
    }),
    (error) => error.code === 'INPUT_INVALID' && error.status === 400,
  );
  await assert.rejects(
    repository.listTasksCreatedBetween({
      userId: USER_A,
      endUtc: 'not-a-date',
    }),
    (error) => error.code === 'INPUT_INVALID' && error.status === 400,
  );
  await assert.rejects(
    repository.listTasksCreatedBetween({
      userId: USER_A,
      startUtc: '2026-07-23T16:00:00.000Z',
      endUtc: '2026-07-22T16:00:00.000Z',
    }),
    (error) => error.code === 'INPUT_INVALID' && error.status === 400,
  );
});

test('new history saves schema_version 2 with distribution_json', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_Dist');
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T08:00:00.000Z',
    randomUUID: () => 'd0000000-0000-4000-8000-000000000001',
  });

  const saved = await repository.save({ userId: USER_A, snapshot: historySnapshot() });
  assert.equal(saved.created, true);

  const row = await database.get(
    'SELECT schema_version, distribution_json FROM time_management_runs WHERE id = ?',
    [saved.item.id],
  );
  assert.equal(row.schema_version, 2);
  const parsed = JSON.parse(row.distribution_json);
  assert.deepEqual(parsed, DISTRIBUTION_FIXTURE);
});

test('getById returns full distribution for Schema 2 rows', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_Detail');
  const repository = createHistoryRepository({
    database,
    randomUUID: () => 'd1000000-0000-4000-8000-000000000001',
  });

  const saved = await repository.save({ userId: USER_A, snapshot: historySnapshot() });
  const detail = await repository.getById({ userId: USER_A, id: saved.item.id });
  assert.deepEqual(detail.distribution, DISTRIBUTION_FIXTURE);
});

test('Schema 1 old row returns distribution: null from getById', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_V1');
  const repository = createHistoryRepository({
    database,
    randomUUID: () => 'd2000000-0000-4000-8000-000000000001',
  });

  // Save using Schema 2, then downgrade the row to Schema 1
  const saved = await repository.save({ userId: USER_A, snapshot: historySnapshot() });
  await database.run(
    'UPDATE time_management_runs SET schema_version = 1, distribution_json = NULL WHERE id = ?',
    [saved.item.id],
  );

  const detail = await repository.getById({ userId: USER_A, id: saved.item.id });
  assert.equal(detail.distribution, null);
  assert.equal(detail.title, historySnapshot().title);
});

test('same clientRunId retry with different distribution does not overwrite first snapshot', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_Idem');
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T08:00:00.000Z',
    randomUUID: () => 'd3000000-0000-4000-8000-000000000001',
  });

  const first = await repository.save({ userId: USER_A, snapshot: historySnapshot() });
  assert.equal(first.created, true);

  const altCategories = DISTRIBUTION_FIXTURE.categories.map((c) => ({ ...c }));
  altCategories[1].percent = 80;
  altCategories[1].status = 'ok';
  altCategories[2].percent = 20;
  altCategories[2].minutes = 180;
  altCategories[2].hours = 3;
  altCategories[2].status = 'ok';
  altCategories[0].percent = 0;
  altCategories[3].percent = 0;
  const altDistribution = {
    ...DISTRIBUTION_FIXTURE,
    totalMinutes: 270,
    totalHours: 4.5,
    categories: altCategories,
    percentages: { 昨天: 0, 今天: 80, 明天: 20, 后天: 0 },
    diagnosis: ['修改后的诊断。'],
    recommendations: ['修改后的建议。'],
  };
  const alt = historySnapshot({ distribution: altDistribution });
  const retry = await repository.save({ userId: USER_A, snapshot: alt });
  assert.equal(retry.created, false);

  const detail = await repository.getById({ userId: USER_A, id: first.item.id });
  assert.deepEqual(detail.distribution, DISTRIBUTION_FIXTURE);
});

test('listTasksCreatedBetween continues to aggregate only tasks without distribution data', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_DailySource');
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-22T10:00:00.000Z',
    randomUUID: () => 'd4000000-0000-4000-8000-000000000001',
  });

  await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({ clientRunId: 'dd000000-0000-4000-8000-000000000001' }),
  });

  const result = await repository.listTasksCreatedBetween({
    userId: USER_A,
    startUtc: '2026-07-22T00:00:00.000Z',
    endUtc: '2026-07-23T00:00:00.000Z',
  });
  assert.equal(result.historyCount, 1);
  assert.equal(result.tasks.length, 2);
  // result.tasks should not have distribution attached
  for (const task of result.tasks) {
    assert.equal(task.distribution, undefined);
  }
});

test('user A cannot read user B distribution snapshot', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_DistA');
  await seedUser(database, USER_B, 'History_DistB');
  const repository = createHistoryRepository({
    database,
    randomUUID: () => 'd5000000-0000-4000-8000-000000000001',
  });

  const saved = await repository.save({ userId: USER_B, snapshot: historySnapshot() });
  assert.equal(await repository.getById({ userId: USER_A, id: saved.item.id }), null);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDailyTrackingRepository,
} = require('../../server/repositories/daily-tracking-repository');
const { createUserRepository } = require('../../server/repositories/user-repository');
const { historySnapshot } = require('../helpers/history-fixture');
const { createTestDatabase } = require('../helpers/test-database');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = '2026-07-23T02:00:00.000Z';

async function seedUser(database, id, username) {
  const users = createUserRepository({ database });
  await database.transaction((transaction) => users.createUser(transaction, {
    id,
    username,
    passwordHash: 'fake-password-hash',
    recoveryCodeHash: 'fake-recovery-hash',
  }));
}

function dailyValue(overrides = {}) {
  const task = historySnapshot().tasks[0];
  return {
    userId: USER_A,
    trackingDate: '2026-07-23',
    tasks: [task],
    tracking: {
      [task.id]: { done: true, doneAt: '2026-07-23T09:30' },
    },
    removedTaskIds: [],
    revision: 0,
    ...overrides,
  };
}

test('daily repository creates, reads, and updates one account-day snapshot', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'Daily_A');
  const repository = createDailyTrackingRepository({
    database,
    now: () => NOW,
    randomUUID: () => '10000000-0000-4000-8000-000000000001',
  });

  const input = dailyValue({
    tasks: [{ ...dailyValue().tasks[0], due: '2026-07-23 09:30' }],
  });
  const created = await repository.save(input);
  assert.equal(created.revision, 1);
  assert.equal(created.updatedAt, NOW);
  assert.equal(created.tasks[0].due, '2026-07-23');
  assert.deepEqual(await repository.get({
    userId: USER_A,
    trackingDate: '2026-07-23',
  }), created);

  const updated = await repository.save(dailyValue({
    tasks: [{ ...dailyValue().tasks[0], name: '用户编辑后的任务名称', due: '2026-07-24' }],
    revision: 1,
  }));
  assert.equal(updated.revision, 2);
  assert.equal(updated.tasks[0].name, '用户编辑后的任务名称');
  assert.equal(updated.tasks[0].due, '2026-07-24');
});

test('daily repository normalizes a missing due without losing the task', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'Daily_Optional_Due');
  const repository = createDailyTrackingRepository({
    database,
    now: () => NOW,
    randomUUID: () => '30000000-0000-4000-8000-000000000003',
  });
  const value = dailyValue();
  delete value.tasks[0].due;

  const saved = await repository.save(value);

  assert.equal(saved.tasks.length, 1);
  assert.equal(saved.tasks[0].due, '待确认');
});

test('daily writes strip legacy times while stored legacy rows remain readable', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'Daily_Date_Only');
  const repository = createDailyTrackingRepository({
    database,
    now: () => NOW,
    randomUUID: () => '39000000-0000-4000-8000-000000000009',
  });
  const input = dailyValue({
    tasks: [{
      ...dailyValue().tasks[0],
      due: '2026-07-20 18:00',
    }],
  });

  const saved = await repository.save(input);
  assert.equal(saved.tasks[0].due, '2026-07-20');

  await database.run(
    'UPDATE daily_tracking_days SET tasks_json = ? WHERE user_id = ? AND tracking_date = ?',
    [
      JSON.stringify([{ ...input.tasks[0], due: '2026-07-20 18:00' }]),
      USER_A,
      input.trackingDate,
    ],
  );

  const legacy = await repository.get({
    userId: USER_A,
    trackingDate: input.trackingDate,
  });
  assert.equal(legacy.tasks[0].due, '2026-07-20 18:00');
});

test('daily repository isolates accounts and rejects stale revisions', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'Daily_A');
  await seedUser(database, USER_B, 'Daily_B');
  const repository = createDailyTrackingRepository({
    database,
    randomUUID: () => '20000000-0000-4000-8000-000000000002',
  });

  await repository.save(dailyValue());
  assert.equal(await repository.get({
    userId: USER_B,
    trackingDate: '2026-07-23',
  }), null);
  assert.equal((await repository.save(dailyValue({ revision: 1 }))).revision, 2);
  await assert.rejects(
    repository.save(dailyValue({ revision: 1 })),
    (error) => error.code === 'DAILY_TRACKING_CONFLICT' && error.status === 409,
  );
});

test('daily repository returns only the newest valid prior snapshot for one account', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'Daily_Latest_A');
  await seedUser(database, USER_B, 'Daily_Latest_B');
  let sequence = 0;
  const repository = createDailyTrackingRepository({
    database,
    randomUUID: () => `40000000-0000-4000-8000-${String(sequence += 1).padStart(12, '0')}`,
  });

  await repository.save(dailyValue({ trackingDate: '2026-07-21' }));
  const expected = await repository.save(dailyValue({ trackingDate: '2026-07-23' }));
  await repository.save(dailyValue({ trackingDate: '2026-07-24' }));
  await repository.save(dailyValue({
    userId: USER_B,
    trackingDate: '2026-07-24',
  }));

  const previous = await repository.getLatestBefore({
    userId: USER_A,
    trackingDate: '2026-07-24',
  });
  assert.deepEqual(previous, expected);
  assert.equal(previous.trackingDate, '2026-07-23');
  assert.equal(await repository.getLatestBefore({
    userId: USER_A,
    trackingDate: '2026-07-21',
  }), null);
});

test('daily repository requires server identity and rejects invalid snapshots', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createDailyTrackingRepository({ database });

  await assert.rejects(
    repository.get({ trackingDate: '2026-07-23' }),
    (error) => error.code === 'AUTH_REQUIRED',
  );
  await assert.rejects(
    repository.getLatestBefore({ trackingDate: '2026-07-23' }),
    (error) => error.code === 'AUTH_REQUIRED',
  );
  await assert.rejects(
    repository.save(dailyValue({ userId: undefined })),
    (error) => error.code === 'AUTH_REQUIRED',
  );
  await assert.rejects(
    repository.save(dailyValue({
      tasks: [dailyValue().tasks[0], dailyValue().tasks[0]],
    })),
    (error) => error.code === 'INPUT_INVALID' && error.status === 400,
  );
});

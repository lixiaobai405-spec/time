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

  const created = await repository.save(dailyValue());
  assert.equal(created.revision, 1);
  assert.equal(created.updatedAt, NOW);
  assert.deepEqual(created.tasks, dailyValue().tasks);
  assert.deepEqual(await repository.get({
    userId: USER_A,
    trackingDate: '2026-07-23',
  }), created);

  const updated = await repository.save(dailyValue({
    tasks: [{ ...dailyValue().tasks[0], name: '用户编辑后的任务名称' }],
    revision: 1,
  }));
  assert.equal(updated.revision, 2);
  assert.equal(updated.tasks[0].name, '用户编辑后的任务名称');
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

test('daily repository requires server identity and rejects invalid snapshots', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createDailyTrackingRepository({ database });

  await assert.rejects(
    repository.get({ trackingDate: '2026-07-23' }),
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

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeUsername, validateUsername } = require('../../server/auth/username');
const { createUserRepository } = require('../../server/repositories/user-repository');
const { createTestDatabase } = require('../helpers/test-database');

const NOW = '2026-07-21T08:00:00.000Z';

function user(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    username: '  Manager_01  ',
    passwordHash: 'password-hash',
    recoveryCodeHash: 'recovery-hash',
    ...overrides,
  };
}

test('username validation trims display text and normalizes ASCII case', () => {
  assert.equal(validateUsername('  Manager_01  '), 'Manager_01');
  assert.equal(normalizeUsername('  Manager_01  '), 'manager_01');
  assert.equal(validateUsername('abc'), 'abc');
  assert.equal(validateUsername('A'.repeat(32)), 'A'.repeat(32));
});

test('username validation rejects invalid length, characters, and types', () => {
  for (const value of ['', 'ab', 'A'.repeat(33), 'manager-name', '管理者', 'manager name', null]) {
    assert.throws(
      () => validateUsername(value),
      (error) => error.code === 'INPUT_INVALID' && !/SQLITE|SELECT|INSERT/i.test(error.message),
    );
  }
});

test('user repository preserves display value and finds users by normalized name or id', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({ database, now: () => NOW });

  await database.transaction((transaction) => repository.createUser(transaction, user()));

  const byName = await repository.findByNormalizedUsername('manager_01');
  assert.deepEqual(byName, {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'Manager_01',
    normalizedUsername: 'manager_01',
    passwordHash: 'password-hash',
    recoveryCodeHash: 'recovery-hash',
    recoveryCodeVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.deepEqual(await repository.findById(byName.id), byName);
  assert.equal(await repository.findById('missing-user'), null);
});

test('normalized username is case-insensitively unique with a stable safe error', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({ database, now: () => NOW });

  await database.transaction((transaction) => repository.createUser(transaction, user()));
  await assert.rejects(
    database.transaction((transaction) => repository.createUser(transaction, user({
      id: '22222222-2222-4222-8222-222222222222',
      username: 'manager_01',
    }))),
    (error) => error.code === 'AUTH_USERNAME_TAKEN'
      && !/SQLITE|users|normalized_username|INSERT/i.test(error.message),
  );
});

test('credential update is parameterized and increments recovery code version', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({
    database,
    now: () => '2026-07-21T09:00:00.000Z',
  });
  await database.transaction((transaction) => repository.createUser(transaction, user()));

  const marker = "new-hash'); DROP TABLE users; --";
  await database.transaction((transaction) => repository.updateCredentials(transaction, {
    userId: user().id,
    passwordHash: marker,
    recoveryCodeHash: 'new-recovery-hash',
  }));

  const updated = await repository.findById(user().id);
  assert.equal(updated.passwordHash, marker);
  assert.equal(updated.recoveryCodeHash, 'new-recovery-hash');
  assert.equal(updated.recoveryCodeVersion, 2);
  assert.equal(updated.updatedAt, '2026-07-21T09:00:00.000Z');
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM users')).count, 1);
});

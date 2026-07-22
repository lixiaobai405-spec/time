const assert = require('node:assert/strict');
const test = require('node:test');

const {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} = require('../../server/security/recovery-code');
const { createUserRepository } = require('../../server/repositories/user-repository');
const { createTestDatabase } = require('../helpers/test-database');

test('recovery code uses 24 random bytes and copyable four-character groups', () => {
  const bytes = Buffer.from(Array.from({ length: 24 }, (_, index) => index));
  const code = generateRecoveryCode((size) => {
    assert.equal(size, 24);
    return bytes;
  });

  assert.match(code, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  assert.equal(normalizeRecoveryCode(code), bytes.toString('hex').toUpperCase());
  assert.equal(normalizeRecoveryCode(`  ${code.toLowerCase()}  `), bytes.toString('hex').toUpperCase());
});

test('recovery code hash is a canonical 32-byte SHA-256 base64url value', () => {
  const code = generateRecoveryCode();
  const storedHash = hashRecoveryCode(code);

  assert.equal(Buffer.from(storedHash, 'base64url').length, 32);
  assert.equal(Buffer.from(storedHash, 'base64url').toString('base64url'), storedHash);
  assert.notEqual(storedHash, code);
  assert.equal(verifyRecoveryCode(code, storedHash), true);
  assert.equal(verifyRecoveryCode(code.replace('-', ' '), storedHash), true);
  assert.equal(verifyRecoveryCode(generateRecoveryCode(), storedHash), false);
});

test('invalid recovery codes fail safely without including their value in errors', () => {
  for (const value of ['', 'ABCD-1234', 'G'.repeat(48), null]) {
    assert.throws(
      () => normalizeRecoveryCode(value),
      (error) => error.code === 'INPUT_INVALID'
        && (!value || !String(error.message).includes(String(value))),
    );
    assert.equal(verifyRecoveryCode(value, 'invalid-hash'), false);
  }
});

test('credential rotation increments the version and makes the old recovery code unusable', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({
    database,
    now: () => '2026-07-21T10:00:00.000Z',
  });
  const oldCode = generateRecoveryCode();
  const newCode = generateRecoveryCode();

  await database.transaction((transaction) => repository.createUser(transaction, {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'Manager_01',
    passwordHash: 'password-hash',
    recoveryCodeHash: hashRecoveryCode(oldCode),
  }));
  await database.transaction((transaction) => repository.updateCredentials(transaction, {
    userId: '11111111-1111-4111-8111-111111111111',
    passwordHash: 'new-password-hash',
    recoveryCodeHash: hashRecoveryCode(newCode),
  }));

  const updated = await repository.findById('11111111-1111-4111-8111-111111111111');
  assert.equal(updated.recoveryCodeVersion, 2);
  assert.equal(verifyRecoveryCode(oldCode, updated.recoveryCodeHash), false);
  assert.equal(verifyRecoveryCode(newCode, updated.recoveryCodeHash), true);
});

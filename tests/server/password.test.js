const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  createPasswordService,
  hashPassword,
  validatePassword,
  verifyPassword,
} = require('../../server/security/password');

test('password validation requires at least six Unicode characters without a maximum', () => {
  assert.equal(validatePassword('Correct-Horse-2026', 'manager_01'), 'Correct-Horse-2026');
  assert.equal(validatePassword('😀'.repeat(6), 'manager_01'), '😀'.repeat(6));
  assert.equal(validatePassword('x'.repeat(10_000), 'manager_01'), 'x'.repeat(10_000));
  assert.equal(validatePassword('MANAGER_01', 'manager_01'), 'MANAGER_01');

  for (const value of ['', '12345', '😀'.repeat(5), null]) {
    assert.throws(
      () => validatePassword(value, 'manager_01'),
      (error) => error.code === 'INPUT_INVALID',
    );
  }
  assert.throws(
    () => validatePassword('manager_01', 'manager_01'),
    (error) => error.code === 'INPUT_INVALID',
  );
});

test('hashPassword emits the fixed versioned scrypt format and verifies safely', async () => {
  const encoded = await hashPassword('Correct-Horse-2026');
  const fields = encoded.split('$');

  assert.deepEqual(fields.slice(0, 5), ['scrypt', 'v=1', 'N=32768', 'r=8', 'p=3']);
  assert.equal(Buffer.from(fields[5], 'base64url').length, 16);
  assert.equal(Buffer.from(fields[6], 'base64url').length, 64);
  assert.equal(await verifyPassword('Correct-Horse-2026', encoded), true);
  assert.equal(await verifyPassword('Wrong-Horse-2026', encoded), false);
});

test('verifyPassword uses timingSafeEqual for valid hashes and rejects damaged encodings', async () => {
  let comparisons = 0;
  const service = createPasswordService({
    timingSafeEqualImpl(left, right) {
      comparisons += 1;
      return crypto.timingSafeEqual(left, right);
    },
  });
  const encoded = await service.hashPassword('Correct-Horse-2026');

  assert.equal(await service.verifyPassword('Correct-Horse-2026', encoded), true);
  assert.equal(comparisons, 1);
  for (const damaged of [
    '',
    'scrypt$v=2$N=32768$r=8$p=3$bad$bad',
    'scrypt$v=1$N=1$r=8$p=3$bad$bad',
    `${encoded}junk`,
    null,
  ]) {
    assert.equal(await service.verifyPassword('Correct-Horse-2026', damaged), false);
  }
});

test('password service limits scrypt work to two concurrent operations', async () => {
  let active = 0;
  let maximumActive = 0;
  const fakeScrypt = (password, salt, keyLength, options, callback) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    setTimeout(() => {
      active -= 1;
      callback(null, Buffer.alloc(keyLength, 7));
    }, 10);
  };
  const service = createPasswordService({ scryptImpl: fakeScrypt, concurrency: 2 });

  await Promise.all(Array.from({ length: 6 }, (_, index) => (
    service.hashPassword(`password-${index}-long-enough`)
  )));

  assert.equal(maximumActive, 2);
});

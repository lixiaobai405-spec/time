const assert = require('node:assert/strict');
const test = require('node:test');

const { createApp } = require('../../server/app');
const { hashRecoveryCode } = require('../../server/security/recovery-code');
const { AuthClient } = require('../helpers/auth-client');
const { createAuthTestApp } = require('../helpers/test-app');

const USERNAME = 'Manager_01';
const PASSWORD = 'Correct-Horse-2026';

test('createApp fails closed when the authentication boundary is missing', () => {
  assert.throws(
    () => createApp({ modelClient: { completeJson: async () => ({}) } }),
    (error) => error.code === 'CONFIG_INVALID' && /authBoundary/.test(error.message),
  );
});

test('registration returns one recovery code without logging the user in', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  const response = await client.register(USERNAME, PASSWORD);
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(payload.user.username, USERNAME);
  assert.match(payload.recoveryCode, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await client.me()).status, 401);

  const row = await database.get(
    'SELECT password_hash, recovery_code_hash FROM users WHERE id = ?',
    [payload.user.id],
  );
  assert.notEqual(row.password_hash, PASSWORD);
  assert.notEqual(row.recovery_code_hash, payload.recoveryCode);
  assert.equal(row.recovery_code_hash, hashRecoveryCode(payload.recoveryCode));
});

test('registration accepts Chinese, unlimited validation lengths, and case-sensitive usernames', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  assert.equal((await client.register('管理者A', '短')).status, 201);
  assert.equal((await client.register('管理者a', 'x'.repeat(1_000))).status, 201);
  assert.equal((await client.login('管理者A', '短')).status, 200);
  assert.equal((await client.login('管理者a', 'x'.repeat(1_000))).status, 200);
});

test('only exact duplicate usernames return a stable 409 response', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  assert.equal((await client.register(USERNAME, PASSWORD)).status, 201);
  assert.equal((await client.register('manager_01', 'Different-Horse-2026')).status, 201);

  const response = await client.register(USERNAME, 'Different-Horse-2026');
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error.code, 'AUTH_USERNAME_TAKEN');
  assert.equal(JSON.stringify(payload).includes('SQLITE'), false);
});

test('unknown users and wrong passwords share the same login failure', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await client.register(USERNAME, PASSWORD);

  const unknown = await client.login('Unknown_01', PASSWORD);
  const unknownPayload = await unknown.json();
  const wrong = await client.login(USERNAME, 'Wrong-Horse-2026');
  const wrongPayload = await wrong.json();
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(
    { code: unknownPayload.error.code, message: unknownPayload.error.message },
    { code: wrongPayload.error.code, message: wrongPayload.error.message },
  );
  assert.equal(unknownPayload.error.code, 'AUTH_INVALID_CREDENTIALS');
});

test('login regenerates the sid and sets the fixed hardened cookie', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await client.register(USERNAME, PASSWORD);
  client.cookie = 'time.sid=s%3Aattacker-controlled.invalid-signature';

  const response = await client.login(USERNAME, PASSWORD);
  const payload = await response.json();
  const setCookie = response.headers.get('set-cookie');
  assert.equal(response.status, 200);
  assert.equal(payload.user.username, USERNAME);
  assert.match(setCookie, /^time\.sid=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=604800/i);
  assert.doesNotMatch(setCookie, /Secure/i);
  assert.equal(setCookie.includes('attacker-controlled'), false);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 1);
});

test('me returns the user and session CSRF token while logout removes only this session', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const first = new AuthClient(baseUrl);
  await first.register(USERNAME, PASSWORD);
  assert.equal((await first.login(USERNAME, PASSWORD)).status, 200);
  const firstMe = await first.me();
  const firstPayload = await firstMe.json();
  assert.equal(firstMe.status, 200);
  assert.equal(firstPayload.user.username, USERNAME);
  assert.match(firstPayload.csrfToken, /^[A-Za-z0-9_-]{43}$/);

  const second = new AuthClient(baseUrl);
  await second.getPreAuthCsrf();
  assert.equal((await second.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await second.me()).status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 2);

  assert.equal((await first.logout()).status, 204);
  assert.equal((await first.me()).status, 401);
  assert.equal((await second.me()).status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 1);
});

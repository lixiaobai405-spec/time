const assert = require('node:assert/strict');
const test = require('node:test');

const { hashRecoveryCode } = require('../../server/security/recovery-code');
const { AuthClient } = require('../helpers/auth-client');
const { createAuthTestApp } = require('../helpers/test-app');

const USERNAME = 'Recovery_Manager';
const PASSWORD = 'Original-Horse-2026';
const NEW_PASSWORD = 'Replacement-Horse-2026';
const CODE_PATTERN = /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/;

async function register(client, username = USERNAME, password = PASSWORD) {
  const response = await client.register(username, password);
  assert.equal(response.status, 201);
  return response.json();
}

async function resetPassword(client, body, csrfToken) {
  if (!client.preAuthCsrfToken) await client.getPreAuthCsrf();
  return client.request('/api/auth/password/reset-with-recovery', {
    method: 'POST',
    csrfToken: csrfToken === undefined ? client.preAuthCsrfToken : csrfToken,
    body,
  });
}

test('recovery reset rotates credentials, revokes every old session, and preserves history', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const registrationClient = new AuthClient(baseUrl);
  const registration = await register(registrationClient);

  const firstSession = new AuthClient(baseUrl);
  const secondSession = new AuthClient(baseUrl);
  await firstSession.getPreAuthCsrf();
  await secondSession.getPreAuthCsrf();
  assert.equal((await firstSession.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await secondSession.login(USERNAME, PASSWORD)).status, 200);

  const timestamp = new Date().toISOString();
  await database.run(
    `INSERT INTO time_management_runs (
      id, user_id, client_run_id, title, goals_json, tasks_json, matrix_json,
      report_json, schema_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      '00000000-0000-4000-8000-000000000901',
      registration.user.id,
      '00000000-0000-4000-8000-000000000902',
      '保留的历史',
      '{}',
      '[]',
      '{}',
      '{}',
      1,
      timestamp,
      timestamp,
    ],
  );

  const resetClient = new AuthClient(baseUrl);
  await resetClient.getPreAuthCsrf();
  const resetResponse = await resetPassword(resetClient, {
    username: USERNAME,
    recoveryCode: registration.recoveryCode,
    newPassword: NEW_PASSWORD,
  });
  const resetPayload = await resetResponse.json();

  assert.equal(resetResponse.status, 200);
  assert.match(resetPayload.recoveryCode, CODE_PATTERN);
  assert.notEqual(resetPayload.recoveryCode, registration.recoveryCode);
  assert.equal((await firstSession.me()).status, 401);
  assert.equal((await secondSession.me()).status, 401);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 0);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM time_management_runs')).count, 1);

  const user = await database.get(
    'SELECT password_hash, recovery_code_hash, recovery_code_version FROM users WHERE id = ?',
    [registration.user.id],
  );
  assert.equal(user.recovery_code_version, 2);
  assert.equal(user.recovery_code_hash, hashRecoveryCode(resetPayload.recoveryCode));
  assert.notEqual(user.password_hash, NEW_PASSWORD);

  const oldPasswordClient = new AuthClient(baseUrl);
  await oldPasswordClient.getPreAuthCsrf();
  assert.equal((await oldPasswordClient.login(USERNAME, PASSWORD)).status, 401);
  assert.equal((await oldPasswordClient.login(USERNAME, NEW_PASSWORD)).status, 200);

  const oldCodeClient = new AuthClient(baseUrl);
  await oldCodeClient.getPreAuthCsrf();
  assert.equal((await resetPassword(oldCodeClient, {
    username: USERNAME,
    recoveryCode: registration.recoveryCode,
    newPassword: 'Another-Replacement-2026',
  })).status, 401);
});

test('recovery reset rolls back credential and session changes when the transaction fails', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  const registration = await register(client);
  assert.equal((await client.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await client.me()).status, 200);

  const before = await database.get(
    'SELECT password_hash, recovery_code_hash, recovery_code_version FROM users WHERE id = ?',
    [registration.user.id],
  );
  await database.exec(`
    CREATE TRIGGER fail_session_revoke
    BEFORE DELETE ON sessions
    BEGIN
      SELECT RAISE(ABORT, 'forced reset rollback');
    END;
  `);

  const resetClient = new AuthClient(baseUrl);
  await resetClient.getPreAuthCsrf();
  const response = await resetPassword(resetClient, {
    username: USERNAME,
    recoveryCode: registration.recoveryCode,
    newPassword: NEW_PASSWORD,
  });
  const payloadText = await response.text();

  assert.equal(response.status, 500);
  assert.equal(payloadText.includes('forced reset rollback'), false);
  assert.equal(payloadText.includes('SQLITE'), false);
  assert.deepEqual(
    await database.get(
      'SELECT password_hash, recovery_code_hash, recovery_code_version FROM users WHERE id = ?',
      [registration.user.id],
    ),
    before,
  );
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 1);
  assert.equal((await client.me()).status, 200);
});

test('unknown usernames and wrong recovery codes share the same reset failure', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  const registration = await register(client);
  await client.getPreAuthCsrf();

  const unknown = await resetPassword(client, {
    username: 'Unknown_Manager',
    recoveryCode: registration.recoveryCode,
    newPassword: NEW_PASSWORD,
  });
  const unknownPayload = await unknown.json();
  const wrong = await resetPassword(client, {
    username: USERNAME,
    recoveryCode: '0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000',
    newPassword: NEW_PASSWORD,
  });
  const wrongPayload = await wrong.json();

  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(
    { code: unknownPayload.error.code, message: unknownPayload.error.message },
    { code: wrongPayload.error.code, message: wrongPayload.error.message },
  );
  assert.equal(unknownPayload.error.code, 'AUTH_INVALID_CREDENTIALS');
});

test('logged-in recovery rotation requires current password and preserves other sessions', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const first = new AuthClient(baseUrl);
  const registration = await register(first);
  assert.equal((await first.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await first.me()).status, 200);

  const second = new AuthClient(baseUrl);
  await second.getPreAuthCsrf();
  assert.equal((await second.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await second.me()).status, 200);

  const response = await first.request('/api/auth/recovery-code/rotate', {
    method: 'POST',
    csrfToken: first.sessionCsrfToken,
    body: { password: PASSWORD },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.recoveryCode, CODE_PATTERN);
  assert.notEqual(payload.recoveryCode, registration.recoveryCode);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 2);
  assert.equal((await first.me()).status, 200);
  assert.equal((await second.me()).status, 200);

  const user = await database.get(
    'SELECT recovery_code_hash, recovery_code_version FROM users WHERE id = ?',
    [registration.user.id],
  );
  assert.equal(user.recovery_code_version, 2);
  assert.equal(user.recovery_code_hash, hashRecoveryCode(payload.recoveryCode));

  const wrongPassword = await first.request('/api/auth/recovery-code/rotate', {
    method: 'POST',
    csrfToken: first.sessionCsrfToken,
    body: { password: 'Wrong-Horse-2026' },
  });
  const wrongPayload = await wrongPassword.json();
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPayload.error.code, 'AUTH_INVALID_CREDENTIALS');
  assert.equal((await database.get(
    'SELECT recovery_code_version AS version FROM users WHERE id = ?',
    [registration.user.id],
  )).version, 2);
});

test('recovery mutations enforce authentication and the correct CSRF boundary', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const anonymous = new AuthClient(baseUrl);
  const registration = await register(anonymous);

  const anonymousRotate = await anonymous.request('/api/auth/recovery-code/rotate', {
    method: 'POST',
    body: { password: PASSWORD },
  });
  assert.equal(anonymousRotate.status, 401);

  assert.equal((await anonymous.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await anonymous.me()).status, 200);
  const missingSessionCsrf = await anonymous.request('/api/auth/recovery-code/rotate', {
    method: 'POST',
    csrfToken: '',
    body: { password: PASSWORD },
  });
  assert.equal(missingSessionCsrf.status, 403);

  const resetClient = new AuthClient(baseUrl);
  await resetClient.getPreAuthCsrf();
  const missingPreAuthCsrf = await resetPassword(resetClient, {
    username: USERNAME,
    recoveryCode: registration.recoveryCode,
    newPassword: NEW_PASSWORD,
  }, '');
  assert.equal(missingPreAuthCsrf.status, 403);
});

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

const { HISTORY_SNAPSHOT_MAX_BYTES } = require('../../server/history/limits');
const { AuthClient } = require('../helpers/auth-client');
const { taskFirstDecompositionFixture } = require('../helpers/decomposition-fixture');
const { maxHistorySnapshot } = require('../helpers/max-history-fixture');
const { DISTRIBUTION_FIXTURE, historySnapshot } = require('../helpers/history-fixture');
const { createAuthTestApp } = require('../helpers/test-app');

const PASSWORD = 'History-Horse-2026';

async function login(client, username) {
  assert.equal((await client.register(username, PASSWORD)).status, 201);
  assert.equal((await client.login(username, PASSWORD)).status, 200);
  assert.equal((await client.me()).status, 200);
}

function saveHistory(client, snapshot, csrfToken = client.sessionCsrfToken) {
  return client.request('/api/time-management/history', {
    method: 'POST',
    csrfToken,
    body: snapshot,
  });
}

function patchCoaching(client, id, body, csrfToken = client.sessionCsrfToken) {
  return client.request(`/api/time-management/history/${id}/coaching-analysis`, {
    method: 'PATCH',
    csrfToken,
    body,
  });
}

test('history APIs require authentication and mutations require session CSRF', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const anonymous = new AuthClient(baseUrl);

  const anonymousList = await anonymous.request('/api/time-management/history');
  assert.equal(anonymousList.status, 401);
  assert.equal((await anonymousList.json()).error.code, 'AUTH_REQUIRED');
  const anonymousSave = await saveHistory(anonymous, historySnapshot(), 'fake-token');
  assert.equal(anonymousSave.status, 401);
  assert.equal((await anonymousSave.json()).error.code, 'AUTH_REQUIRED');
  const oversizedAnonymous = await saveHistory(anonymous, {
    padding: 'x'.repeat(HISTORY_SNAPSHOT_MAX_BYTES + 1),
  }, 'fake-token');
  assert.equal(oversizedAnonymous.status, 401);
  assert.equal((await oversizedAnonymous.json()).error.code, 'AUTH_REQUIRED');

  const client = new AuthClient(baseUrl);
  await login(client, 'History_Csrf');
  const missing = await saveHistory(client, historySnapshot(), '');
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error.code, 'AUTH_CSRF_INVALID');
  const incorrect = await saveHistory(client, historySnapshot(), 'incorrect-token');
  assert.equal(incorrect.status, 403);
  assert.equal((await incorrect.json()).error.code, 'AUTH_CSRF_INVALID');
});

test('save is idempotent and rejects client-supplied identity fields', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_Save');

  const firstResponse = await saveHistory(client, historySnapshot());
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201);
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.equal(first.title, historySnapshot().title);

  const retryResponse = await saveHistory(client, historySnapshot({
    title: '幂等重试不应覆盖原记录',
  }));
  const retry = await retryResponse.json();
  assert.equal(retryResponse.status, 200);
  assert.equal(retry.id, first.id);
  assert.equal(retry.title, first.title);

  for (const identity of [{ userId: randomUUID() }, { user_id: randomUUID() }]) {
    const response = await saveHistory(client, { ...historySnapshot(), ...identity });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INPUT_INVALID');
  }
});

test('list defaults to 20, caps at 50, and cursor pagination has no duplicates', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_List');

  for (let index = 0; index < 52; index += 1) {
    const response = await saveHistory(client, historySnapshot({
      clientRunId: randomUUID(),
      title: `历史记录 ${String(index + 1).padStart(2, '0')}`,
    }));
    assert.equal(response.status, 201);
  }

  const defaultResponse = await client.request('/api/time-management/history');
  const defaultPage = await defaultResponse.json();
  assert.equal(defaultResponse.status, 200);
  assert.equal(defaultPage.items.length, 20);
  assert.equal(typeof defaultPage.nextCursor, 'string');
  assert.deepEqual(
    Object.keys(defaultPage.items[0]).sort(),
    ['createdAt', 'id', 'title', 'updatedAt'],
  );

  const cappedResponse = await client.request('/api/time-management/history?limit=999');
  const cappedPage = await cappedResponse.json();
  assert.equal(cappedResponse.status, 200);
  assert.equal(cappedPage.items.length, 50);
  assert.equal(typeof cappedPage.nextCursor, 'string');

  const ids = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: '17' });
    if (cursor) query.set('cursor', cursor);
    const response = await client.request(`/api/time-management/history?${query}`);
    const page = await response.json();
    assert.equal(response.status, 200);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 52);
  assert.equal(new Set(ids).size, 52);
});

test('POST with distribution saves and returns 201 with full distribution', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_Dist');

  const response = await saveHistory(client, historySnapshot());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body.distribution, DISTRIBUTION_FIXTURE);
});

test('POST without distribution returns 400 INPUT_INVALID', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_NoDist');

  const snapshot = historySnapshot();
  delete snapshot.distribution;
  const response = await saveHistory(client, snapshot);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INPUT_INVALID');
});

test('POST with invalid distribution structure returns 400 INPUT_INVALID', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_BadDist');

  const snapshot = historySnapshot();
  snapshot.distribution = { ...DISTRIBUTION_FIXTURE, totalMinutes: 'bad' };
  const response = await saveHistory(client, snapshot);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INPUT_INVALID');
});

test('authenticated history create uses the dedicated snapshot body budget', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_LargeBody');

  const response = await saveHistory(client, {
    ...historySnapshot(),
    padding: 'x'.repeat(70 * 1024),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INPUT_INVALID');
});

test('maximum legal version-3 history snapshot fits request and response budgets', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_MaxBody');

  const response = await saveHistory(client, maxHistorySnapshot());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.tasks.length, 100);
  assert.equal(body.decomposition.stages.length, 2);
});

test('authenticated history create rejects bodies over the dedicated snapshot budget', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_OverBudget');

  const response = await saveHistory(client, {
    padding: 'x'.repeat(HISTORY_SNAPSHOT_MAX_BYTES + 1),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

test('error responses do not leak task content, raw JSON, SQL, or stack traces', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_Safe');

  const snapshot = historySnapshot();
  snapshot.distribution = { ...DISTRIBUTION_FIXTURE, totalMinutes: 'not-a-number' };
  const response = await saveHistory(client, snapshot);
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INPUT_INVALID');
  assert.ok(!/SQLITE|SELECT|INSERT|time_management|分布/.test(JSON.stringify(body)));
});

test('coaching PATCH conditionally enriches only the owned version-3 decomposition', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const owner = new AuthClient(baseUrl);
  const other = new AuthClient(baseUrl);
  await login(owner, 'History_Coaching_Owner');
  await login(other, 'History_Coaching_Other');
  const snapshot = historySnapshot({
    goals: { 昨天: '', 今天: '今天18:00前提交方案', 明天: '', 后天: '' },
  });
  snapshot.decomposition = taskFirstDecompositionFixture(snapshot);
  const savedResponse = await saveHistory(owner, snapshot);
  const saved = await savedResponse.json();
  const coachingStage = taskFirstDecompositionFixture(
    snapshot,
    { withCoaching: true },
  ).stages[1];
  const body = {
    decompositionId: snapshot.decomposition.decompositionId,
    analysisId: coachingStage.analysisId,
    coachingStage,
  };

  const missingCsrf = await patchCoaching(owner, saved.id, body, '');
  assert.equal(missingCsrf.status, 403);
  const forbidden = await patchCoaching(other, saved.id, body);
  assert.equal(forbidden.status, 404);

  const patchedResponse = await patchCoaching(owner, saved.id, body);
  const patched = await patchedResponse.json();
  assert.equal(patchedResponse.status, 200);
  assert.equal(patched.decomposition.stages.length, 2);
  assert.equal(patched.decomposition.stages[1].analysisId, body.analysisId);
  assert.deepEqual(patched.tasks, saved.tasks);

  const retryResponse = await patchCoaching(owner, saved.id, body);
  assert.equal(retryResponse.status, 200);
  const injected = await patchCoaching(owner, saved.id, {
    ...body,
    decomposition: snapshot.decomposition,
  });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).error.code, 'INPUT_INVALID');

  const conflictingStage = {
    ...coachingStage,
    analysisId: '55555555-5555-4555-8555-555555555555',
  };
  const conflict = await patchCoaching(owner, saved.id, {
    ...body,
    analysisId: conflictingStage.analysisId,
    coachingStage: conflictingStage,
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'HISTORY_COACHING_CONFLICT');
});

test('detail and delete conceal ownership and deletion requires CSRF', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const owner = new AuthClient(baseUrl);
  const other = new AuthClient(baseUrl);
  await login(owner, 'History_Owner');
  await login(other, 'History_Other');

  const savedResponse = await saveHistory(owner, historySnapshot());
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 201);

  const ownerDetailResponse = await owner.request(`/api/time-management/history/${saved.id}`);
  const ownerDetail = await ownerDetailResponse.json();
  assert.equal(ownerDetailResponse.status, 200);
  assert.equal(ownerDetail.tasks[0].due, '待确认');
  assert.deepEqual(ownerDetail.report, historySnapshot().report);

  const absentId = randomUUID();
  const forbiddenResponse = await other.request(`/api/time-management/history/${saved.id}`);
  const absentResponse = await other.request(`/api/time-management/history/${absentId}`);
  const forbidden = await forbiddenResponse.json();
  const absent = await absentResponse.json();
  assert.equal(forbiddenResponse.status, 404);
  assert.equal(absentResponse.status, 404);
  assert.deepEqual(
    { code: forbidden.error.code, message: forbidden.error.message },
    { code: absent.error.code, message: absent.error.message },
  );
  assert.equal(forbidden.error.code, 'HISTORY_NOT_FOUND');

  const missingCsrf = await owner.request(`/api/time-management/history/${saved.id}`, {
    method: 'DELETE',
    csrfToken: '',
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error.code, 'AUTH_CSRF_INVALID');

  const otherDelete = await other.request(`/api/time-management/history/${saved.id}`, {
    method: 'DELETE',
    csrfToken: other.sessionCsrfToken,
  });
  assert.equal(otherDelete.status, 404);
  assert.equal((await otherDelete.json()).error.code, 'HISTORY_NOT_FOUND');
  assert.equal((await owner.request(`/api/time-management/history/${saved.id}`)).status, 200);

  const ownerDelete = await owner.request(`/api/time-management/history/${saved.id}`, {
    method: 'DELETE',
    csrfToken: owner.sessionCsrfToken,
  });
  assert.equal(ownerDelete.status, 204);
  assert.equal(await ownerDelete.text(), '');
  assert.equal((await owner.request(`/api/time-management/history/${saved.id}`)).status, 404);
});

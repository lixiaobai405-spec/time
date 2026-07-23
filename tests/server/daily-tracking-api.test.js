const assert = require('node:assert/strict');
const test = require('node:test');

const { AuthClient } = require('../helpers/auth-client');
const { historySnapshot } = require('../helpers/history-fixture');
const { createAuthTestApp } = require('../helpers/test-app');

const PASSWORD = 'Daily-Track-2026';

async function login(client, username) {
  assert.equal((await client.register(username, PASSWORD)).status, 201);
  assert.equal((await client.login(username, PASSWORD)).status, 200);
  assert.equal((await client.me()).status, 200);
}

function saveHistory(client, snapshot = historySnapshot()) {
  return client.request('/api/time-management/history', {
    method: 'POST',
    csrfToken: client.sessionCsrfToken,
    body: snapshot,
  });
}

function saveDaily(client, body, csrfToken = client.sessionCsrfToken) {
  return client.request('/api/time-management/daily-tracking/today', {
    method: 'PUT',
    csrfToken,
    body,
  });
}

test('daily tracking API requires authentication and CSRF for writes', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const anonymous = new AuthClient(baseUrl);
  assert.equal(
    (await anonymous.request('/api/time-management/daily-tracking/today')).status,
    401,
  );

  const client = new AuthClient(baseUrl);
  await login(client, 'Daily_Csrf');
  const openedResponse = await client.request('/api/time-management/daily-tracking/today');
  const opened = await openedResponse.json();
  assert.equal(openedResponse.status, 200);
  const missing = await saveDaily(client, {
    trackingDate: opened.trackingDate,
    tasks: [],
    tracking: {},
    removedTaskIds: [],
    revision: 0,
  }, '');
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error.code, 'AUTH_CSRF_INVALID');
});

test('daily API merges history, persists edits, rejects stale saves, and leaves history immutable', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'Daily_Owner');
  const historyResponse = await saveHistory(client);
  const history = await historyResponse.json();
  assert.equal(historyResponse.status, 201);

  const openedResponse = await client.request('/api/time-management/daily-tracking/today');
  const opened = await openedResponse.json();
  assert.equal(openedResponse.status, 200);
  assert.equal(opened.sourceSummary.historyCount, 1);
  assert.equal(opened.sourceSummary.taskCount, 2);
  assert.deepEqual(opened.tasks, historySnapshot().tasks);
  assert.equal(opened.revision, 0);

  const editedTasks = opened.tasks.map((task, index) => (
    index === 0 ? { ...task, name: '每日跟踪中的编辑' } : task
  ));
  const savedResponse = await saveDaily(client, {
    trackingDate: opened.trackingDate,
    tasks: editedTasks,
    tracking: {
      [editedTasks[0].id]: { done: true, doneAt: `${opened.trackingDate}T09:30` },
    },
    removedTaskIds: [],
    revision: opened.revision,
  });
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 200);
  assert.equal(saved.revision, 1);
  assert.equal(saved.tasks[0].name, '每日跟踪中的编辑');

  const stale = await saveDaily(client, {
    trackingDate: opened.trackingDate,
    tasks: editedTasks,
    tracking: {},
    removedTaskIds: [],
    revision: 0,
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'DAILY_TRACKING_CONFLICT');

  const detail = await (await client.request(
    `/api/time-management/history/${history.id}`,
  )).json();
  assert.equal(detail.tasks[0].name, historySnapshot().tasks[0].name);
});

test('daily API isolates accounts and rejects a stale business date', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const owner = new AuthClient(baseUrl);
  const other = new AuthClient(baseUrl);
  await login(owner, 'Daily_One');
  await login(other, 'Daily_Two');
  assert.equal((await saveHistory(owner)).status, 201);

  const otherToday = await (await other.request(
    '/api/time-management/daily-tracking/today',
  )).json();
  assert.equal(otherToday.sourceSummary.historyCount, 0);
  assert.deepEqual(otherToday.tasks, []);

  const changed = await saveDaily(other, {
    trackingDate: '2000-01-01',
    tasks: [],
    tracking: {},
    removedTaskIds: [],
    revision: 0,
  });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, 'DAILY_TRACKING_DATE_CHANGED');
});

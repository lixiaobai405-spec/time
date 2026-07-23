const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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

function remapHistoryTaskIds(snapshot, taskIds) {
  const idMap = new Map(snapshot.tasks.map((task, index) => [task.id, taskIds[index]]));
  return {
    ...snapshot,
    clientRunId: randomUUID(),
    title: '第二条当天历史',
    tasks: snapshot.tasks.map(task => ({ ...task, id: idMap.get(task.id) })),
    matrix: {
      ...snapshot.matrix,
      classifications: snapshot.matrix.classifications.map(item => ({
        ...item,
        taskId: idMap.get(item.taskId),
      })),
      quadrants: snapshot.matrix.quadrants.map(item => ({
        ...item,
        taskIds: item.taskIds.map(taskId => idMap.get(taskId)),
      })),
    },
    report: {
      ...snapshot.report,
      order: snapshot.report.order.map(item => ({
        ...item,
        taskId: idMap.get(item.taskId),
      })),
    },
  };
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
  assert.deepEqual(opened.tasks, historySnapshot().tasks.map(task => ({
    ...task,
    due: task.due === '今天18:00'
      ? `${opened.trackingDate} 18:00`
      : '待确认',
  })));
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

test('deleting history removes its edited daily tasks but keeps other history tasks', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'Daily_Delete_Source');

  const firstResponse = await saveHistory(client);
  const first = await firstResponse.json();
  const secondSnapshot = remapHistoryTaskIds(historySnapshot(), [
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ]);
  assert.equal((await saveHistory(client, secondSnapshot)).status, 201);

  const opened = await (await client.request(
    '/api/time-management/daily-tracking/today',
  )).json();
  const firstIds = new Set(historySnapshot().tasks.map(task => task.id));
  const secondIds = secondSnapshot.tasks.map(task => task.id);
  assert.equal(opened.tasks.length, 4);

  const editedTasks = opened.tasks.map(task => (
    firstIds.has(task.id) ? { ...task, name: `已编辑：${task.name}` } : task
  ));
  const savedResponse = await saveDaily(client, {
    trackingDate: opened.trackingDate,
    tasks: editedTasks,
    tracking: {
      [historySnapshot().tasks[0].id]: {
        done: true,
        doneAt: `${opened.trackingDate}T09:30`,
      },
    },
    removedTaskIds: [],
    revision: opened.revision,
  });
  assert.equal(savedResponse.status, 200);
  const savedBeforeDelete = await savedResponse.json();

  const deleted = await client.request(
    `/api/time-management/history/${first.id}`,
    {
      method: 'DELETE',
      csrfToken: client.sessionCsrfToken,
    },
  );
  assert.equal(deleted.status, 204);

  const reconciled = await (await client.request(
    '/api/time-management/daily-tracking/today',
  )).json();
  assert.deepEqual(reconciled.tasks.map(task => task.id), secondIds);
  assert.deepEqual(reconciled.tracking, {});
  assert.equal(reconciled.sourceSummary.historyCount, 1);
  assert.equal(reconciled.sourceSummary.taskCount, 2);
  assert.equal(reconciled.hasUnpersistedMerge, true);

  const persistedResponse = await saveDaily(client, {
    trackingDate: savedBeforeDelete.trackingDate,
    tasks: savedBeforeDelete.tasks,
    tracking: savedBeforeDelete.tracking,
    removedTaskIds: savedBeforeDelete.removedTaskIds,
    revision: savedBeforeDelete.revision,
  });
  assert.equal(persistedResponse.status, 200);
  const persisted = await persistedResponse.json();
  assert.deepEqual(persisted.tasks.map(task => task.id), secondIds);
  assert.equal(persisted.hasUnpersistedMerge, false);
});

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
      ? '待确认'
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

test('daily API carries only unchecked tasks across skipped Shanghai days', async (t) => {
  let currentInstant = new Date('2026-07-23T02:00:00.000Z');
  const { baseUrl, database } = await createAuthTestApp(t, {
    now: () => currentInstant,
  });
  const client = new AuthClient(baseUrl);
  await login(client, 'Daily_Carry_Clock');

  const historyResponse = await saveHistory(client);
  assert.equal(historyResponse.status, 201);

  const openedResponse = await client.request('/api/time-management/daily-tracking/today');
  const opened = await openedResponse.json();
  assert.equal(openedResponse.status, 200);
  assert.equal(opened.trackingDate, '2026-07-23');
  const task1 = opened.tasks[0];
  const task2 = opened.tasks[1];

  const editedTask2 = { ...task2, name: '跨日编辑后名称', due: '2026-07-25', owner: '张三' };
  const day1Save = await saveDaily(client, {
    trackingDate: opened.trackingDate,
    tasks: [task1, editedTask2],
    tracking: {
      [task1.id]: { done: true, doneAt: '2026-07-23T09:30' },
    },
    removedTaskIds: [],
    revision: opened.revision,
  });
  assert.equal(day1Save.status, 200);
  const day1Saved = await day1Save.json();
  assert.equal(day1Saved.revision, 1);

  currentInstant = new Date('2026-07-26T02:00:00.000Z');
  const day3Get = await client.request('/api/time-management/daily-tracking/today');
  const day3 = await day3Get.json();
  assert.equal(day3Get.status, 200);
  assert.equal(day3.trackingDate, '2026-07-26');
  const task1InDay3 = day3.tasks.find(t => t.id === task1.id);
  assert.equal(task1InDay3, undefined, 'done:true task must NOT carry over');
  const task2InDay3 = day3.tasks.find(t => t.id === task2.id);
  assert.ok(task2InDay3, 'task without tracking entry must carry over');
  assert.equal(task2InDay3.name, '跨日编辑后名称');
  assert.equal(task2InDay3.due, '2026-07-25');
  assert.equal(task2InDay3.owner, '张三');
  assert.equal(task2InDay3.source, task2.source, 'source must not change');
  assert.equal(day3.tracking[task2.id]?.done, undefined, 'carried task must not have done:true');
  assert.equal(day3.revision, 0, 'new day GET must not auto-write DB');

  const day3Save = await saveDaily(client, {
    trackingDate: day3.trackingDate,
    tasks: [],
    tracking: {},
    removedTaskIds: [task2.id],
    revision: day3.revision,
  });
  assert.equal(day3Save.status, 200);

  currentInstant = new Date('2026-07-27T02:00:00.000Z');
  const day4Get = await client.request('/api/time-management/daily-tracking/today');
  const day4 = await day4Get.json();
  assert.equal(day4Get.status, 200);
  assert.equal(day4.trackingDate, '2026-07-27');
  assert.equal(day4.tasks.find(t => t.id === task2.id), undefined, 'deleted task must not reappear');
});

test('daily API includes history generated after prior snapshot as delta', async (t) => {
  let currentInstant = new Date('2026-07-23T02:00:00.000Z');
  const { baseUrl } = await createAuthTestApp(t, {
    now: () => currentInstant,
  });
  const client = new AuthClient(baseUrl);
  await login(client, 'Daily_Delta_Clock');

  const firstHistory = await saveHistory(client);
  assert.equal(firstHistory.status, 201);
  const opened = await (await client.request('/api/time-management/daily-tracking/today')).json();
  const day1TaskIds = opened.tasks.map(t => t.id);

  await saveDaily(client, {
    trackingDate: opened.trackingDate,
    tasks: opened.tasks,
    tracking: {},
    removedTaskIds: [],
    revision: opened.revision,
  });

  currentInstant = new Date('2026-07-23T03:00:00.000Z');
  const secondSnapshot = remapHistoryTaskIds(historySnapshot(), [
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
  ]);
  const secondHistory = await saveHistory(client, secondSnapshot);
  assert.equal(secondHistory.status, 201);

  currentInstant = new Date('2026-07-24T02:00:00.000Z');
  const day2Get = await client.request('/api/time-management/daily-tracking/today');
  const day2 = await day2Get.json();
  assert.equal(day2Get.status, 200);
  assert.equal(day2.trackingDate, '2026-07-24');
  for (const id of day1TaskIds) {
    assert.ok(day2.tasks.find(t => t.id === id), `day1 task ${id} must carry over`);
  }
  for (const id of secondSnapshot.tasks.map(t => t.id)) {
    assert.ok(day2.tasks.find(t => t.id === id), `delta task ${id} must appear`);
  }
  assert.equal(day2.tasks.length, day1TaskIds.length + secondSnapshot.tasks.length);
});

test('daily API returns 409 when merged tasks exceed capacity', async (t) => {
  let currentInstant = new Date('2026-07-23T02:00:00.000Z');
  const { baseUrl, database } = await createAuthTestApp(t, {
    now: () => currentInstant,
  });
  const client = new AuthClient(baseUrl);
  await login(client, 'Daily_Cap_Clock');

  for (let batch = 0; batch < 51; batch += 1) {
    const idA = `${String(batch * 2 + 1).padStart(8, '0')}-0000-4000-8000-000000000000`;
    const idB = `${String(batch * 2 + 2).padStart(8, '0')}-0000-4000-8000-000000000000`;
    const twoTaskSnapshot = remapHistoryTaskIds(historySnapshot(), [idA, idB]);
    assert.equal((await saveHistory(client, twoTaskSnapshot)).status, 201);
  }

  const overResponse = await client.request('/api/time-management/daily-tracking/today');
  assert.equal(overResponse.status, 409);
  const body = await overResponse.json();
  assert.equal(body.error.code, 'DAILY_TRACKING_CAPACITY_EXCEEDED');
  assert.doesNotMatch(body.error.message, /SQLITE|SELECT|tasks_json/i);

  const row = await database.get(
    'SELECT COUNT(*) AS count FROM daily_tracking_days WHERE user_id = ? AND tracking_date = ?',
    [(await (await client.request('/api/auth/me')).json()).user.id, '2026-07-23'],
  );
  assert.equal(row?.count || 0, 0, 'DB must not be auto-written on capacity error');
});

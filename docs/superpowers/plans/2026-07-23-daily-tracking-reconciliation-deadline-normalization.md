# Daily Tracking Reconciliation and Deadline Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove tasks whose source history was deleted from the current account-day checklist, and convert deterministic relative deadlines to concrete Shanghai dates while marking ambiguous deadlines as `待确认`.

**Architecture:** Keep the existing API and SQLite schema. Extend the shared deadline policy with a deterministic formatter, then reconcile every saved daily snapshot against the current set of task IDs returned by today's surviving histories. The existing frontend `hasUnpersistedMerge` path persists reconciliation results automatically.

**Tech Stack:** Node.js 20, CommonJS, Express 5, SQLite3, Node test runner, Playwright

---

## File map

- Modify `server/policies/deadline.js`: parse `后天`, format parsed deadlines, replace ambiguous deadlines with `待确认`, and preserve urgency rules.
- Modify `server/daily-tracking/service.js`: reconcile saved daily tasks, tracking state, and removal tombstones against surviving history task IDs.
- Modify `tests/server/deadline-policy.test.js`: specify relative, explicit, invalid, ambiguous, cross-month, and cross-year date behavior.
- Modify `tests/server/extract-tasks.test.js`: prove AI task extraction returns concrete deadlines.
- Modify `tests/server/daily-tracking-service.test.js`: prove edited stale tasks and their state are removed while surviving edits remain.
- Modify `tests/server/daily-tracking-api.test.js`: prove deleting one history removes only that history's tasks and stale saves cannot restore them.
- Modify this plan file only to mark completed checkboxes after each verified step.

No database migration, API shape change, frontend layout change, or new dependency is required.

### Task 1: Normalize deadlines before tasks reach the UI

**Files:**
- Modify: `tests/server/deadline-policy.test.js`
- Modify: `tests/server/extract-tasks.test.js`
- Modify: `server/policies/deadline.js`

- [x] **Step 1: Add failing deadline normalization tests**

Add `normalizeDue` to the import in `tests/server/deadline-policy.test.js`:

```js
const {
  applyDeadlineUrgency,
  normalizeDue,
  parseDue,
  parseExplicitDue,
  referenceDateInTimeZone,
} = require('../../server/policies/deadline');
```

Extend the existing relative-date test with `后天`:

```js
  assert.deepEqual(parseDue('后天 08:05', context), {
    date: '2026-07-22',
    time: '08:05',
    sortKey: '2026-07-22T08:05',
  });
```

Add these focused tests after the relative-date parser test:

```js
test('可确定截止时间标准化为具体上海日期', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.equal(normalizeDue('今天', context), '2026-07-20');
  assert.equal(normalizeDue('今日 8:05 前', context), '2026-07-20 08:05');
  assert.equal(normalizeDue('明天 09:30', context), '2026-07-21 09:30');
  assert.equal(normalizeDue('后天', context), '2026-07-22');
  assert.equal(normalizeDue('2026-07-31T16:00', context), '2026-07-31 16:00');
});

test('相对日期标准化正确跨月和跨年', () => {
  assert.equal(normalizeDue('明天', {
    now: () => new Date('2026-07-31T04:00:00.000Z'),
    timeZone: 'Asia/Shanghai',
  }), '2026-08-01');
  assert.equal(normalizeDue('后天', {
    now: () => new Date('2026-12-30T04:00:00.000Z'),
    timeZone: 'Asia/Shanghai',
  }), '2027-01-01');
});

test('无法唯一确定或无效的截止时间统一为待确认', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  for (const value of ['', '待确认', '尽快', '月底', '近期', '本周五', '2026-02-30']) {
    assert.equal(normalizeDue(value, context), '待确认', value);
  }
});

test('紧急度纠偏同时回写标准截止日期且不丢失原始紧迫信号', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.deepEqual(
    applyDeadlineUrgency(task({ due: '明天 09:00', urgency: '高' }), context),
    {
      ...task({ due: '明天 09:00', urgency: '高' }),
      due: '2026-07-21 09:00',
      urgency: '中',
    },
  );
  assert.equal(
    applyDeadlineUrgency(task({ due: '尽快', urgency: '低' }), context).urgency,
    '高',
  );
  assert.equal(
    applyDeadlineUrgency(task({ due: '尽快', urgency: '低' }), context).due,
    '待确认',
  );
});
```

Update the existing urgency case for `本周五` because the approved design treats it as unknown:

```js
    { name: '不可解析自然期限', input: { source: '复盘', due: '本周五', urgency: '高' }, expected: '低' },
```

Add this test to `tests/server/extract-tasks.test.js` after the current “模型缺少截止时间” test:

```js
test('模型相对截止时间转换为具体上海日期且模糊期限变为待确认', async () => {
  const now = () => new Date('2026-07-20T04:00:00.000Z');
  const result = await extractTasks({
    goals: goals({
      今天: '今天提交方案，另有事项尽快处理',
      明天: '明天提交验收清单',
      后天: '后天完成复盘',
    }),
    now,
    modelClient: queuedModel([{ tasks: [
      modelTask({ name: '提交方案', due: '今天18:00' }),
      modelTask({ name: '处理模糊事项', due: '尽快' }),
      modelTask({
        name: '提交验收清单',
        source: '短期目标',
        due: '明天',
        acceptanceCriteria: ['清单已提交'],
      }),
      modelTask({
        name: '完成复盘',
        source: '中长期',
        due: '后天 09:30',
        acceptanceCriteria: ['复盘已记录'],
      }),
    ] }]),
  });

  assert.deepEqual(result.tasks.map(item => item.due), [
    '2026-07-20 18:00',
    '待确认',
    '2026-07-21',
    '2026-07-22 09:30',
  ]);
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js
```

Expected: FAIL because `normalizeDue` is not exported and `后天` is not parsed.

- [x] **Step 3: Implement the minimal deadline normalizer**

In `server/policies/deadline.js`, extend the relative pattern:

```js
const RELATIVE_DUE_PATTERN = /^(今天|今日|明天|后天)(?:\s*([01]?\d|2[0-3]):([0-5]\d)\s*前?)?$/;
```

Replace the relative-day offset calculation in `parseRelativeDue`:

```js
  const offsets = { 今天: 0, 今日: 0, 明天: 1, 后天: 2 };
  const date = addCalendarDays(referenceDate, offsets[relativeDay]);
```

Add the formatter after `parseDue`:

```js
function normalizeDue(due, context = {}) {
  const parsed = parseDue(due, context);
  if (!parsed) return '待确认';
  return parsed.time ? `${parsed.date} ${parsed.time}` : parsed.date;
}
```

Update `applyDeadlineUrgency` so it normalizes the returned task but checks urgency signals against the original task:

```js
function applyDeadlineUrgency(task, context = {}) {
  const parsed = parseDue(task?.due, context);
  const result = {
    ...task,
    due: normalizeDue(task?.due, context),
  };
  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  if (parsed && parsed.date <= referenceDate) {
    result.urgency = '高';
    return result;
  }

  if (hasUrgencySignal(task, context.goalText)) {
    result.urgency = '高';
    return result;
  }

  if (parsed) {
    const daysUntilDue = calendarDayDistance(referenceDate, parsed.date);
    result.urgency = daysUntilDue <= 7 ? '中' : '低';
    return result;
  }

  if (result.source === '今天') {
    result.urgency = '高';
  } else {
    result.urgency = '低';
  }
  return result;
}
```

Export the new function:

```js
module.exports = {
  DEFAULT_TIME_ZONE,
  applyDeadlineUrgency,
  normalizeDue,
  parseDue,
  parseExplicitDue,
  referenceDateInTimeZone,
};
```

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js
```

Expected: all tests pass with zero failures.

- [x] **Step 5: Commit Task 1**

```powershell
git add -- server/policies/deadline.js tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js
git diff --cached --check
git commit -m "fix: normalize task deadlines"
```

### Task 2: Reconcile daily tracking against surviving histories

**Files:**
- Modify: `tests/server/daily-tracking-service.test.js`
- Modify: `tests/server/daily-tracking-api.test.js`
- Modify: `server/daily-tracking/service.js`

- [x] **Step 1: Add a failing service regression test**

Add this test to `tests/server/daily-tracking-service.test.js` after the existing merge test:

```js
test('daily merge removes edited tasks whose source history disappeared', () => {
  const survivingSource = historySnapshot().tasks[0];
  const deletedSource = historySnapshot().tasks[1];
  const staleRemovedId = '44444444-4444-4444-8444-444444444444';
  const result = mergeDailyTracking({
    saved: {
      tasks: [
        { ...survivingSource, name: '保留用户编辑', due: '明天' },
        { ...deletedSource, name: '来源删除后即使编辑也删除' },
      ],
      tracking: {
        [survivingSource.id]: { done: true, doneAt: '2026-07-20T09:30' },
        [deletedSource.id]: { done: true, doneAt: '2026-07-20T10:00' },
      },
      removedTaskIds: [staleRemovedId],
      revision: 3,
      updatedAt: '2026-07-20T02:00:00.000Z',
    },
    sourceTasks: [survivingSource],
    dueContext: {
      now: () => new Date('2026-07-20T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    },
  });

  assert.deepEqual(result.tasks.map(item => item.id), [survivingSource.id]);
  assert.equal(result.tasks[0].name, '保留用户编辑');
  assert.equal(result.tasks[0].due, '2026-07-21');
  assert.deepEqual(result.tracking, {
    [survivingSource.id]: { done: true, doneAt: '2026-07-20T09:30' },
  });
  assert.deepEqual(result.removedTaskIds, []);
  assert.equal(result.hasUnpersistedMerge, true);
});
```

Pass a fixed `dueContext` to the existing merge test so its relative fixture deadline remains deterministic:

```js
    dueContext: {
      now: () => new Date('2026-07-20T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    },
```

- [x] **Step 2: Add a failing API regression test for history deletion**

Add the Node crypto import to `tests/server/daily-tracking-api.test.js`:

```js
const { randomUUID } = require('node:crypto');
```

Add a helper that creates a valid second history with different task IDs:

```js
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
```

Add the integration test:

```js
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
```

Update the existing daily API assertion that compares raw history tasks, because daily tracking now standardizes source deadlines while history remains immutable:

```js
  assert.deepEqual(opened.tasks, historySnapshot().tasks.map(task => ({
    ...task,
    due: task.due === '今天18:00'
      ? `${opened.trackingDate} 18:00`
      : '待确认',
  })));
```

- [x] **Step 3: Run service and API tests and verify RED**

Run:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
```

Expected: FAIL because the current merge keeps saved tasks whose IDs disappeared from history and retains stale tracking/tombstones.

- [x] **Step 4: Implement reconciliation in the daily tracking service**

Import the shared formatter at the top of `server/daily-tracking/service.js`:

```js
const { normalizeDue } = require('../policies/deadline');
```

Replace `mergeDailyTracking` with:

```js
function mergeDailyTracking({ saved, sourceTasks, dueContext = {} }) {
  const value = saved || {
    tasks: [],
    tracking: {},
    removedTaskIds: [],
    revision: 0,
    updatedAt: null,
  };
  const sourceById = new Map();
  for (const task of sourceTasks || []) {
    if (!sourceById.has(task.id)) sourceById.set(task.id, task);
  }
  const sourceIds = new Set(sourceById.keys());
  const removedTaskIds = (value.removedTaskIds || [])
    .filter(taskId => sourceIds.has(taskId));
  const removed = new Set(removedTaskIds);
  let changed = removedTaskIds.length !== (value.removedTaskIds || []).length;

  const tasks = [];
  const present = new Set();
  for (const task of value.tasks || []) {
    if (!sourceIds.has(task.id) || removed.has(task.id)) {
      changed = true;
      continue;
    }
    const normalized = { ...task, due: normalizeDue(task.due, dueContext) };
    if (normalized.due !== task.due) changed = true;
    tasks.push(normalized);
    present.add(task.id);
  }

  for (const task of sourceById.values()) {
    if (present.has(task.id) || removed.has(task.id)) continue;
    tasks.push({ ...task, due: normalizeDue(task.due, dueContext) });
    present.add(task.id);
    changed = true;
  }

  const tracking = Object.fromEntries(
    Object.entries(value.tracking || {}).filter(([taskId]) => present.has(taskId)),
  );
  if (Object.keys(tracking).length !== Object.keys(value.tracking || {}).length) {
    changed = true;
  }

  return {
    tasks: JSON.parse(JSON.stringify(tasks)),
    tracking: JSON.parse(JSON.stringify(tracking)),
    removedTaskIds,
    revision: value.revision || 0,
    updatedAt: value.updatedAt || null,
    hasUnpersistedMerge: changed,
  };
}
```

Capture one instant per service operation and pass it to both the business-day calculation and deadline normalization. Update `getToday`:

```js
    async getToday({ userId } = {}) {
      const instant = now();
      const day = shanghaiBusinessDay(instant);
      const [saved, source] = await Promise.all([
        dailyTrackingRepository.get({ userId, trackingDate: day.trackingDate }),
        sourceForDay(userId, day),
      ]);
      return responseFor(day, source, mergeDailyTracking({
        saved,
        sourceTasks: source.tasks,
        dueContext: { now: instant, timeZone: 'Asia/Shanghai' },
      }));
    },
```

Update `saveToday` in the same way:

```js
    async saveToday({ userId, snapshot } = {}) {
      const value = validateDailyWrite(snapshot);
      const instant = now();
      const day = shanghaiBusinessDay(instant);
      if (value.trackingDate !== day.trackingDate) throw dateChangedError();
      const source = await sourceForDay(userId, day);
      const merged = mergeDailyTracking({
        saved: value,
        sourceTasks: source.tasks,
        dueContext: { now: instant, timeZone: 'Asia/Shanghai' },
      });
      const stored = await dailyTrackingRepository.save({
        userId,
        trackingDate: day.trackingDate,
        tasks: merged.tasks,
        tracking: merged.tracking,
        removedTaskIds: merged.removedTaskIds,
        revision: value.revision,
      });
      return responseFor(day, source, {
        ...stored,
        hasUnpersistedMerge: false,
      });
    },
```

- [x] **Step 5: Run service and API tests and verify GREEN**

Run:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
```

Expected: all tests pass with zero failures.

- [x] **Step 6: Commit Task 2**

```powershell
git add -- server/daily-tracking/service.js tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
git diff --cached --check
git commit -m "fix: reconcile daily tasks with history"
```

### Task 3: Verify the complete product contract

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-daily-tracking-reconciliation-deadline-normalization.md`

- [x] **Step 1: Run the complete server suite**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:server
```

Expected: all server tests pass with `fail 0`.

- [x] **Step 2: Run the browser regression suite**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:e2e
```

Expected: all Playwright tests pass.

- [x] **Step 3: Inspect the final diff and requirement coverage**

Run:

```powershell
git status --short --branch
git diff --check
git diff --stat
git diff -- server/policies/deadline.js server/daily-tracking/service.js tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
```

Verify:

- Deleted-history task IDs are removed from tasks and tracking state.
- Edited surviving task IDs retain the saved version.
- Stale `removedTaskIds` are removed.
- `hasUnpersistedMerge` becomes true for every reconciliation change.
- Relative dates use `Asia/Shanghai`.
- Ambiguous dates become `待确认`.
- No API shape, migration, dependency, `.env`, or unrelated file changed.

- [x] **Step 4: Mark this plan complete and commit only the plan**

Change all completed task checkboxes in this file from `[ ]` to `[x]`, then run:

```powershell
git add -f -- docs/superpowers/plans/2026-07-23-daily-tracking-reconciliation-deadline-normalization.md
git diff --cached --check
git commit -m "docs: complete daily reconciliation plan"
```

- [x] **Step 5: Report the exact verification evidence**

Report:

- Focused RED failures observed before production changes.
- Focused GREEN test counts after each implementation.
- Complete server test count and `fail 0`.
- Playwright test count.
- Commit hashes created by Tasks 1–3.
- Unrelated pre-existing working-tree changes left untouched.

## Verification evidence

- Task 1 RED: 29 focused tests ran; 7 failed for the missing normalizer, missing `后天` parser, unchanged relative output, and old ambiguous-deadline behavior.
- Task 1 GREEN: 29/29 focused deadline and extraction tests passed.
- Task 1 commit: `8fd96fc fix: normalize task deadlines`.
- Task 2 RED: 10 focused tests ran; 3 failed because daily tracking retained deleted-history tasks and relative source deadlines.
- Task 2 GREEN: 10/10 focused service and API tests passed.
- Task 2 commit: `6b6d5bd fix: reconcile daily tasks with history`.
- Complete server regression: 230/230 passed with Node.js `20.20.2`; `fail 0`.
- Complete Playwright regression: 8/8 passed.
- Scope audit: no `package.json`, `package-lock.json`, `.env`, or database migration changes.
- Preserved unrelated working-tree state: `.gitignore` remains modified and `tests/manual-test-input-template.md` remains untracked.

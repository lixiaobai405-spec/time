# Account Daily Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one automatically saved, account-scoped daily tracking checklist from every history record generated on the current Asia/Shanghai calendar day.

**Architecture:** Add a non-destructive SQLite table keyed by user and business date, a focused daily-tracking service that merges immutable history snapshots by task ID, and authenticated GET/PUT routes with optimistic revisions. Replace the current session-only daily page with server-backed state and an 800ms debounced autosave while preserving the existing five-step and history contracts.

**Tech Stack:** Node.js 20, Express 5, SQLite3, Ajv, browser ES modules, Node test runner, Playwright.

---

## File map

- Create `server/database/migrations/003-daily-tracking.js`: daily checklist table and indexes.
- Modify `server/database/migrations.js`: register migration 3.
- Create `server/daily-tracking/business-date.js`: Asia/Shanghai date and UTC range conversion.
- Create `server/daily-tracking/contracts.js`: validate stored and incoming daily snapshots.
- Create `server/repositories/daily-tracking-repository.js`: account/date read and revision-checked upsert.
- Modify `server/repositories/history-repository.js`: fetch current user's history task snapshots within a UTC range.
- Create `server/daily-tracking/service.js`: ID-based source merge, tombstones, cross-day and revision rules.
- Create `server/daily-tracking/router.js`: GET/PUT transport and stable problem responses.
- Modify `server/runtime.js`: construct and expose the daily router.
- Modify `server/app.js`: mount the authenticated daily route.
- Modify `frontend/api.js`: add `putJson`.
- Modify `frontend/state.js`: add/reset persistent daily view state.
- Modify `frontend/app.js`: load today, render the source summary, autosave edits, confirm deletion, guard unsaved navigation, and add the history-detail entry.
- Modify `frontend/index.html`: saving-state, empty-state, and daily action styles.
- Create `tests/server/daily-tracking-repository.test.js`: migration, isolation, JSON, and revision tests.
- Create `tests/server/daily-tracking-service.test.js`: day boundary, merge, deduplication, tombstone, and source precedence tests.
- Create `tests/server/daily-tracking-api.test.js`: auth, CSRF, ownership, validation, conflicts, and history immutability tests.
- Modify `tests/reference-auth-history.spec.js`: history entry and server-backed daily autosave browser tests.
- Modify `tests/reference-five-step.spec.js`: replace session-only daily assumptions with today-list API fixtures.

### Task 1: Migration and Shanghai business-date boundary

**Files:**
- Create: `server/database/migrations/003-daily-tracking.js`
- Modify: `server/database/migrations.js`
- Create: `server/daily-tracking/business-date.js`
- Test: `tests/server/database.test.js`
- Test: `tests/server/daily-tracking-service.test.js`

- [ ] **Step 1: Write failing migration and date tests**

Add assertions that migration version 3 exists, `daily_tracking_days` has a unique `(user_id, tracking_date)` constraint, and:

```js
assert.deepEqual(shanghaiBusinessDay(new Date('2026-07-22T15:59:59.999Z')), {
  trackingDate: '2026-07-22',
  startUtc: '2026-07-21T16:00:00.000Z',
  endUtc: '2026-07-22T16:00:00.000Z',
});
assert.equal(
  shanghaiBusinessDay(new Date('2026-07-22T16:00:00.000Z')).trackingDate,
  '2026-07-23',
);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/server/database.test.js tests/server/daily-tracking-service.test.js
```

Expected: FAIL because migration 3 and `shanghaiBusinessDay` do not exist.

- [ ] **Step 3: Add migration and date utility**

Migration SQL:

```sql
CREATE TABLE daily_tracking_days (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tracking_date TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  tracking_json TEXT NOT NULL,
  removed_task_ids_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX daily_tracking_days_user_date_unique
  ON daily_tracking_days (user_id, tracking_date);
```

Implement `shanghaiBusinessDay(now)` with `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })`, then derive UTC start/end using the fixed `+08:00` offset.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/database/migrations.js server/database/migrations/003-daily-tracking.js server/daily-tracking/business-date.js tests/server/database.test.js tests/server/daily-tracking-service.test.js
git commit -m "feat: add daily tracking storage migration"
```

### Task 2: Contracts, repository, and immutable history source query

**Files:**
- Create: `server/daily-tracking/contracts.js`
- Create: `server/repositories/daily-tracking-repository.js`
- Modify: `server/repositories/history-repository.js`
- Test: `tests/server/daily-tracking-repository.test.js`
- Test: `tests/server/history-repository.test.js`

- [ ] **Step 1: Write failing repository tests**

Cover:

```js
const created = await repository.save({
  userId,
  trackingDate: '2026-07-23',
  tasks: [task],
  tracking: { [task.id]: { done: true, doneAt: '2026-07-23T09:00' } },
  removedTaskIds: [],
  revision: 0,
});
assert.equal(created.revision, 1);
await assert.rejects(
  repository.save({ ...nextValue, revision: 0 }),
  error => error.code === 'DAILY_TRACKING_CONFLICT',
);
assert.equal((await repository.get({ userId: otherId, trackingDate: '2026-07-23' })), null);
```

Also save histories on both sides of the Shanghai UTC boundary and assert `listTasksCreatedBetween` returns only the current user and `[startUtc, endUtc)` rows ordered by `created_at, id`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/server/daily-tracking-repository.test.js tests/server/history-repository.test.js
```

Expected: FAIL because repository methods and contracts are missing.

- [ ] **Step 3: Implement validation and persistence**

`validateDailyWrite` accepts only:

```js
{
  trackingDate: 'YYYY-MM-DD',
  tasks: [/* existing complete task shape, max TASK_LIMIT */],
  tracking: { '<uuid>': { done: true, doneAt: 'YYYY-MM-DDTHH:mm' } },
  removedTaskIds: ['<uuid>'],
  revision: 0,
}
```

Reject additional identity fields, duplicate task IDs, tracking keys absent from visible tasks, visible IDs also present in tombstones, invalid dates, and malformed stored JSON. Repository `save` performs insert-on-revision-zero or update with `WHERE revision = ?`, then throws `DAILY_TRACKING_CONFLICT` if no row changed.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/daily-tracking/contracts.js server/repositories/daily-tracking-repository.js server/repositories/history-repository.js tests/server/daily-tracking-repository.test.js tests/server/history-repository.test.js
git commit -m "feat: persist account daily tracking snapshots"
```

### Task 3: Merge service and protected API

**Files:**
- Create: `server/daily-tracking/service.js`
- Create: `server/daily-tracking/router.js`
- Modify: `server/runtime.js`
- Modify: `server/app.js`
- Test: `tests/server/daily-tracking-service.test.js`
- Test: `tests/server/daily-tracking-api.test.js`

- [ ] **Step 1: Write failing service and API tests**

Service cases:

```js
assert.deepEqual(
  merged.tasks.map(task => task.id),
  [savedEditedTask.id, sameNameDifferentId.id, newlyGeneratedTask.id],
);
assert.equal(merged.tasks[0].name, '用户编辑后的名称');
assert.ok(!merged.tasks.some(task => task.id === removedTask.id));
assert.equal(merged.hasUnpersistedMerge, true);
```

API cases:

- anonymous GET/PUT returns `401 AUTH_REQUIRED`;
- PUT without CSRF returns `403 AUTH_CSRF_INVALID`;
- GET merges all and only current Shanghai-day histories;
- same ID deduplicates and same-name/different-ID tasks remain;
- PUT with stale `revision` returns `409 DAILY_TRACKING_CONFLICT`;
- stale `trackingDate` returns `409 DAILY_TRACKING_DATE_CHANGED`;
- saving never changes `time_management_runs.tasks_json`;
- a second account cannot read or overwrite the first account's checklist.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
```

Expected: FAIL because service, router, and route wiring are missing.

- [ ] **Step 3: Implement service and router**

The service reads `shanghaiBusinessDay(now())`, loads same-day source tasks and the saved row, then merges:

```js
const sourceById = new Map();
for (const task of sourceTasks) {
  if (!sourceById.has(task.id)) sourceById.set(task.id, task);
}
const removed = new Set(saved?.removedTaskIds || []);
const tasks = (saved?.tasks || []).filter(task => !removed.has(task.id));
const present = new Set(tasks.map(task => task.id));
for (const task of sourceById.values()) {
  if (!present.has(task.id) && !removed.has(task.id)) tasks.push(task);
}
```

GET returns `trackingDate`, merged tasks/tracking, `revision`, `updatedAt`, `sourceSummary`, and `hasUnpersistedMerge`. PUT validates the current business date, re-merges source tasks that appeared during editing, and persists with the submitted revision. Map input errors to 400, conflicts to 409, and unavailable storage to 503 without exposing task text.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/daily-tracking server/repositories server/runtime.js server/app.js tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
git commit -m "feat: expose account daily tracking API"
```

### Task 4: Frontend state, rendering, and autosave

**Files:**
- Modify: `frontend/api.js`
- Modify: `frontend/state.js`
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`
- Modify: `tests/reference-auth-history.spec.js`
- Modify: `tests/reference-five-step.spec.js`

- [ ] **Step 1: Add failing Playwright coverage**

Mock or use the real daily endpoint and assert:

```js
await page.getByRole('button', { name: '进入每日跟踪' }).click();
await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
await expect(page.getByText(/已汇总今天生成的 2 条记录，共 3 项任务/)).toBeVisible();
await page.locator('[data-daily-task-field="name"]').first().fill('用户编辑后的名称');
await expect(page.getByText('正在保存…')).toBeVisible();
await expect(page.getByText('已自动保存')).toBeVisible();
expect(savedPayload.tasks[0].name).toBe('用户编辑后的名称');
```

Also cover deletion confirmation and tombstone payload, refresh restore, old-history entry still opening today, empty state, retry after PUT failure, and no leave warning after a successful save.

- [ ] **Step 2: Run Playwright and verify RED**

```powershell
npx playwright test tests/reference-auth-history.spec.js tests/reference-five-step.spec.js
```

Expected: FAIL because the history entry and server-backed daily state do not exist.

- [ ] **Step 3: Implement minimal frontend behavior**

Add `putJson(path, body)` without global workflow cancellation. Extend state with:

```js
daily: {
  loaded: false,
  loading: false,
  trackingDate: '',
  tasks: [],
  tracking: {},
  removedTaskIds: [],
  revision: 0,
  updatedAt: null,
  sourceSummary: { historyCount: 0, taskCount: 0 },
  saveStatus: 'idle',
  error: null,
}
```

On navigation to `daily`, GET today before rendering task rows. Daily edits use `data-daily-task-field`, update `state.daily`, set `saveStatus = 'dirty'`, and reset an 800ms timer. PUT the full daily snapshot, accept the server response, and show `saving`, `saved`, or `failed`. Do not call `invalidateAfterTasks`, mutate workflow `state.tasks`, or use session rollover.

Add “进入每日跟踪” to every history detail. It only calls `navigate('daily')`. Delete daily tasks only after `window.confirm`, add the ID to `removedTaskIds`, then autosave.

- [ ] **Step 4: Implement leave and unload protection**

Treat `dirty`, `saving`, and `failed` as unsafe. Guard top navigation, history back, brand navigation, and logout with:

```js
if (hasUnsafeDailyChanges() && !window.confirm('每日跟踪仍有未保存更改，确定离开吗？')) return;
```

Register `beforeunload` only while unsafe. On version/date conflict, retain local inputs, set failed state, and present the server message with a reload-today action.

- [ ] **Step 5: Run Playwright and verify GREEN**

Run the Step 2 command. Expected: all selected Playwright tests pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend/api.js frontend/state.js frontend/app.js frontend/index.html tests/reference-auth-history.spec.js tests/reference-five-step.spec.js
git commit -m "feat: autosave account daily tracking"
```

### Task 5: Regression, completion audit, and delivery

**Files:**
- Modify only files required to fix demonstrated regressions.

- [ ] **Step 1: Run focused server tests**

```powershell
node --test tests/server/database.test.js tests/server/history-repository.test.js tests/server/daily-tracking-repository.test.js tests/server/daily-tracking-service.test.js tests/server/daily-tracking-api.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full server suite**

```powershell
npm run test:server
```

Expected: all server tests pass with zero failures.

- [ ] **Step 3: Run full browser suite**

```powershell
npm run test:e2e
```

Expected: all configured Playwright tests pass with zero failures.

- [ ] **Step 4: Run repository checks**

```powershell
git diff --check
git status --short
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors; only the user's pre-existing `.gitignore` and `tests/manual-test-input-template.md` remain outside feature commits.

- [ ] **Step 5: Review completion evidence against the design**

Confirm every acceptance criterion in `docs/superpowers/specs/2026-07-23-account-daily-tracking-design.md`: account/day uniqueness, same-day aggregation, old-history entry behavior, ID deduplication, autosave persistence, deletion tombstones, new-source append, immutable history, conflict/date errors, security, and non-destructive migration.

- [ ] **Step 6: Push and verify GitHub**

```powershell
git push origin main
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: push succeeds and both hashes are identical.

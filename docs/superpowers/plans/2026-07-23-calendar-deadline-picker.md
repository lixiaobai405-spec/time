# Calendar Deadline Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text deadline editing in AI task confirmation and daily tracking with a native calendar date picker plus an optional time picker.

**Architecture:** Keep the existing `task.due` API and database contract unchanged. Add small parsing/combining helpers in `frontend/app.js`, render separate native date/time inputs in both task tables, and route their changes through the existing workflow invalidation and daily autosave paths.

**Tech Stack:** Browser-native HTML date/time inputs, vanilla JavaScript ES modules, existing CSS, Playwright end-to-end tests, Node.js 20.

---

## File map

- Modify `frontend/app.js`: parse and combine deadline strings, render both input pairs, and update task state.
- Modify `frontend/index.html`: size the wider deadline columns and responsive date/time input group.
- Modify `tests/reference-five-step.spec.js`: verify AI confirmation date/time rendering and state submission.
- Modify `tests/reference-auth-history.spec.js`: verify daily tracking rendering, optional time, clearing, and autosave.
- Modify this plan: check completed tasks after verification.

No dependency, server API, migration, or database file changes are required.

### Task 1: AI confirmation calendar and optional time

**Files:**
- Modify: `tests/reference-five-step.spec.js:3-22`
- Modify: `tests/reference-five-step.spec.js:120-160`
- Modify: `frontend/app.js:55-85`
- Modify: `frontend/app.js:312-324`
- Modify: `frontend/app.js:961-977`
- Modify: `frontend/index.html:128-136`

- [x] **Step 1: Write the failing AI confirmation test**

Change the first mocked task deadline so existing date-time data is covered:

```js
{
  id: 'task-y', name: '补交上周未完成的月报', source: '复盘',
  due: '2026-07-22 18:00', est: '1h',
  importance: '高', urgency: '高', acceptanceCriteria: [],
  nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
},
```

Add a helper that reaches step two without completing all five steps:

```js
async function openAiConfirmation(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#entry-昨天').fill('补交上周未完成的月报');
  await page.locator('#entry-今天').fill('完成今天的方案终稿校对');
  await page.locator('#entry-明天').fill('梳理内容审核流程规范');
  await page.locator('#entry-后天').fill('制定团队能力建设季度规划');
  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('AI 拆解确认');
}
```

Reuse it at the start of `completeFiveSteps`, then add this test:

```js
test('AI 拆解确认用日历选择日期并保留可选时间', async ({ page }) => {
  let smartPayload = null;
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/tasks/smart-check')) {
      smartPayload = request.postDataJSON();
    }
  });

  await openAiConfirmation(page);

  const firstRow = page.locator('[data-task-row="task-y"]');
  const date = firstRow.locator('[data-task-field="dueDate"]');
  const time = firstRow.locator('[data-task-field="dueTime"]');

  await expect(date).toHaveAttribute('type', 'date');
  await expect(time).toHaveAttribute('type', 'time');
  await expect(date).toHaveValue('2026-07-22');
  await expect(time).toHaveValue('18:00');

  await date.fill('2026-07-25');
  await time.fill('');
  await page.getByRole('button', { name: 'SMART 校验' }).click();
  expect(smartPayload.tasks[0].due).toBe('2026-07-25');

  await date.fill('');
  await expect(time).toBeDisabled();
  await page.getByRole('button', { name: 'SMART 校验' }).click();
  expect(smartPayload.tasks[0].due).toBe('待确认');
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx playwright test tests/reference-five-step.spec.js -g "AI 拆解确认用日历选择日期并保留可选时间"
```

Expected: FAIL because `[data-task-field="dueDate"]` and `[data-task-field="dueTime"]` do not exist.

- [x] **Step 3: Add deadline parsing and combining helpers**

Add near the other top-level utility functions in `frontend/app.js`:

```js
const DUE_VALUE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/;

function splitDueValue(value) {
  const match = DUE_VALUE_PATTERN.exec(String(value || '').trim());
  return match
    ? { date: match[1], time: match[2] || '' }
    : { date: '', time: '' };
}

function combineDueValue(currentValue, field, value) {
  const current = splitDueValue(currentValue);
  const date = field === 'dueDate' ? value : current.date;
  const time = field === 'dueTime' ? value : current.time;
  if (!date) return '待确认';
  return time ? `${date} ${time}` : date;
}
```

This accepts the two existing persisted forms, treats `待确认` as empty controls, and never creates a time-only deadline.

- [x] **Step 4: Render native inputs in AI confirmation**

At the start of `taskEditRow`, derive the parts:

```js
const due = splitDueValue(task.due);
```

Replace its free-text deadline input with:

```js
<div>
  <span class="mobile-label">截止时间</span>
  <div class="due-inputs">
    <input
      type="date"
      data-task-id="${escapeHtml(task.id)}"
      data-task-field="dueDate"
      value="${escapeHtml(due.date)}"
      class="${fields.has('due') ? 'miss' : ''}"
      aria-label="截止日期">
    <input
      type="time"
      data-task-id="${escapeHtml(task.id)}"
      data-task-field="dueTime"
      value="${escapeHtml(due.time)}"
      aria-label="截止时间（可选）"
      ${due.date ? '' : 'disabled'}>
  </div>
</div>
```

Update `updateTask` so the two fields preserve the current API value:

```js
else if (field === 'dueDate' || field === 'dueTime') {
  task.due = combineDueValue(task.due, field, value);
}
```

Remove the obsolete `field === 'due'` branch after both render sites have been converted.

- [x] **Step 5: Add desktop and mobile layout rules**

In `frontend/index.html`, update the grid widths and add:

```css
.g-edit{grid-template-columns:minmax(160px,1.6fr) 88px 190px 82px 128px 30px}
.g-daily{grid-template-columns:26px minmax(160px,1.5fr) 78px 190px 70px 122px 150px 28px}
.due-inputs{display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:5px;min-width:0}
.due-inputs input{min-width:0}
```

Inside the existing narrow-screen media query add:

```css
.due-inputs{grid-template-columns:1fr}
```

- [x] **Step 6: Run the focused test and AI workflow regression**

Run:

```powershell
npx playwright test tests/reference-five-step.spec.js
```

Expected: all tests in `reference-five-step.spec.js` PASS, including the new date/time test and the existing 375px overflow test.

- [x] **Step 7: Commit Task 1**

```powershell
git add frontend/app.js frontend/index.html tests/reference-five-step.spec.js
git commit -m "feat: add calendar deadline inputs"
```

Expected: the commit contains only the three listed files.

### Task 2: Daily tracking date/time autosave

**Files:**
- Modify: `tests/reference-auth-history.spec.js:77-285`
- Modify: `frontend/app.js:417-431`
- Modify: `frontend/app.js:714-729`
- Modify: `frontend/app.js:1361-1377`

- [x] **Step 1: Write the failing daily tracking assertions**

In the existing test `旧历史入口打开今天清单并自动保存编辑和删除`, use concrete persisted deadlines:

```js
const taskOne = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '当天任务一',
  importance: '高',
  urgency: '高',
  source: '今天',
  due: '2026-07-23 18:00',
  est: '1h',
  acceptanceCriteria: [],
  nextAction: '',
  status: 'pending',
  classificationSource: 'ai-extraction',
};

const taskTwo = {
  ...taskOne,
  id: '22222222-2222-4222-8222-222222222222',
  name: '当天任务二',
  source: '短期目标',
  due: '2026-07-24',
};
```

After entering daily tracking, add:

```js
const firstDailyRow = page.locator(
  `[data-daily-task-id="${taskOne.id}"]`,
);
const dueDate = firstDailyRow.locator('[data-daily-due-part="dueDate"]');
const dueTime = firstDailyRow.locator('[data-daily-due-part="dueTime"]');

await expect(dueDate).toHaveAttribute('type', 'date');
await expect(dueTime).toHaveAttribute('type', 'time');
await expect(dueDate).toHaveValue('2026-07-23');
await expect(dueTime).toHaveValue('18:00');

savedPayload = null;
await dueDate.fill('2026-07-25');
await dueTime.fill('19:30');
await expect.poll(() => savedPayload?.tasks?.[0]?.due)
  .toBe('2026-07-25 19:30');

savedPayload = null;
await dueTime.fill('');
await expect.poll(() => savedPayload?.tasks?.[0]?.due)
  .toBe('2026-07-25');

savedPayload = null;
await dueDate.fill('');
await expect(dueTime).toBeDisabled();
await expect(dueTime).toHaveValue('');
await expect.poll(() => savedPayload?.tasks?.[0]?.due)
  .toBe('待确认');
```

- [x] **Step 2: Run the focused daily test and verify it fails**

Run:

```powershell
npx playwright test tests/reference-auth-history.spec.js -g "旧历史入口打开今天清单并自动保存编辑和删除"
```

Expected: FAIL because the daily date/time selectors do not exist.

- [x] **Step 3: Render daily date and optional time inputs**

At the start of `dailyTaskRow`, derive:

```js
const due = splitDueValue(task.due);
```

Replace the daily free-text deadline input with:

```js
<div>
  <span class="mobile-label">截止时间</span>
  <div class="due-inputs">
    <input
      type="date"
      data-daily-task-id="${escapeHtml(task.id)}"
      data-daily-due-part="dueDate"
      value="${escapeHtml(due.date)}"
      aria-label="截止日期">
    <input
      type="time"
      data-daily-task-id="${escapeHtml(task.id)}"
      data-daily-due-part="dueTime"
      value="${escapeHtml(due.time)}"
      aria-label="截止时间（可选）"
      ${due.date ? '' : 'disabled'}>
  </div>
</div>
```

- [x] **Step 4: Route daily date/time changes through autosave**

Update `updateDailyTask`:

```js
else if (field === 'dueDate' || field === 'dueTime') {
  task.due = combineDueValue(task.due, field, value);
}
```

In the document `change` handler, before completion-time handling, add:

```js
const dailyDueTaskId = event.target.dataset.dailyTaskId;
const dailyDuePart = event.target.dataset.dailyDuePart;
if (dailyDueTaskId && dailyDuePart) {
  updateDailyTask(dailyDueTaskId, dailyDuePart, event.target.value);
  render();
  return;
}
```

The date/time inputs use `change`, not the task-name `input` path, so a completed picker choice causes one state update and one autosave schedule. Re-rendering immediately disables and clears the time control when the date becomes empty.

- [x] **Step 5: Run the focused daily test**

Run:

```powershell
npx playwright test tests/reference-auth-history.spec.js -g "旧历史入口打开今天清单并自动保存编辑和删除"
```

Expected: PASS, with saved values observed in this order:

```text
2026-07-25 19:30
2026-07-25
待确认
```

- [x] **Step 6: Run all daily/history UI tests**

Run:

```powershell
npx playwright test tests/reference-auth-history.spec.js
```

Expected: all tests in `reference-auth-history.spec.js` PASS, including autosave conflict protection and mobile navigation.

- [x] **Step 7: Commit Task 2**

```powershell
git add frontend/app.js tests/reference-auth-history.spec.js
git commit -m "test: cover daily deadline autosave"
```

Expected: the commit contains only the two listed files.

### Task 3: Full regression and completion record

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-calendar-deadline-picker.md`

- [x] **Step 1: Run server regression tests**

Run:

```powershell
npm run test:server
```

Expected: all Node server tests PASS. The exact count may grow over time; zero failures is the acceptance condition.

- [x] **Step 2: Run the complete Playwright suite**

Run:

```powershell
npm run test:e2e
```

Expected: all Playwright tests PASS with zero failures.

- [x] **Step 3: Inspect the final diff and dependency boundary**

Run:

```powershell
git status --short --branch
git diff HEAD~2 -- frontend/app.js frontend/index.html tests/reference-five-step.spec.js tests/reference-auth-history.spec.js
git diff HEAD~2 -- package.json package-lock.json
```

Expected:

- Feature diff is limited to the four planned files.
- `package.json` and `package-lock.json` have no changes.
- Existing user changes to `.gitignore` and `tests/manual-test-input-template.md` remain untouched.

- [x] **Step 4: Update this plan with verification evidence**

Check all completed boxes and append the actual server-test and Playwright results under a `## Verification` section. Do not claim tests passed unless their current command output shows zero failures.

- [x] **Step 5: Commit the completed plan**

```powershell
git add -f docs/superpowers/plans/2026-07-23-calendar-deadline-picker.md
git commit -m "docs: complete calendar deadline plan"
```

Expected: only this plan document is committed.

## Deployment impact

This feature does not change `package.json` or `package-lock.json`. During the next server update, the normal deployment script should report:

```text
Dependencies unchanged: skipping npm ci
```

The service still needs a restart and both health checks must return `{"status":"ok"}`.

## Verification

Verified on 2026-07-23:

- AI confirmation RED: failed because `dueDate` did not exist.
- AI confirmation focused GREEN: 1 passed, 0 failed.
- `tests/reference-five-step.spec.js`: 5 passed, 0 failed.
- Daily tracking RED: failed because `data-daily-due-part="dueDate"` did not exist.
- Daily tracking focused GREEN: 1 passed, 0 failed.
- `tests/reference-auth-history.spec.js`: 4 passed, 0 failed.
- Complete Playwright suite: 9 passed, 0 failed.
- Server suite on the local Node 24.15.0 environment: 229 passed, 1 failed.
- The single server failure is the pre-existing runtime assertion that requires Node 20.20.2; the same failure was present in the pre-change baseline and the user approved continuing with it documented.
- `git diff a62c14e..HEAD -- package.json package-lock.json`: no changes.
- Existing user changes in `.gitignore` and `tests/manual-test-input-template.md` remained untouched.

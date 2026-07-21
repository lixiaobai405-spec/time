# Time Assistant Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved hybrid fixes for long-term effort display, deterministic urgency correction, matrix regression coverage, and report schedule conflicts.

**Architecture:** Keep `est` and all public contracts unchanged, but filter long-term effort at the two UI rendering boundaries. Extend the existing deadline policy with relative-date and urgency-signal handling, then add a focused report-schedule policy that derives non-persistent constraints and rejects conflicting explicit time ranges through the workflow's existing one-retry path.

**Tech Stack:** Node.js CommonJS, Express, AJV, Node test runner, Playwright, vanilla JavaScript, Markdown prompts.

---

## File map

- Modify `server/policies/deadline.js`: parse relative due dates and apply the approved urgency override.
- Modify `server/workflows/extract-tasks.js`: pass the matching original goal into the urgency policy.
- Modify `prompts/system.md`: tell extraction and report models the deterministic rules and schedule constraints.
- Create `server/policies/report-schedule.js`: build ephemeral schedule context and detect conflicting explicit ranges.
- Modify `server/workflows/generate-report.js`: send schedule context and reject conflicts before returning.
- Modify `frontend/app.js`: omit `est` from current long-term task cards.
- Modify `frontend/history-ui.js`: omit `est` from long-term history details.
- Modify `tests/server/deadline-policy.test.js`: cover relative dates, future downgrade, signals, and immutability.
- Modify `tests/server/extract-tasks.test.js`: prove the API/workflow passes source goal text to the policy.
- Create `tests/server/report-schedule.test.js`: cover context construction, duration parsing, conflict, and false-positive boundaries.
- Modify `tests/server/generate-report.test.js`: cover retry, repeated conflict, request context, and API safety.
- Modify `tests/frontend.spec.js`: cover current-card effort visibility.
- Modify `tests/auth-history.spec.js`: cover history-detail effort visibility.
- Re-run `tests/server/classify-matrix.test.js`: preserve task conservation, empty quadrants, and 55/25/15/5.

### Task 1: Deterministic urgency policy

**Files:**
- Modify: `tests/server/deadline-policy.test.js`
- Modify: `tests/server/extract-tasks.test.js`
- Modify: `server/policies/deadline.js`
- Modify: `server/workflows/extract-tasks.js`
- Modify: `prompts/system.md`

- [ ] **Step 1: Write failing policy tests**

Add cases equivalent to:

```js
test('相对日期按上海参考日解析', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.equal(parseDue('今天18:00', context).date, '2026-07-20');
  assert.equal(parseDue('明天 09:30', context).date, '2026-07-21');
});

test('未来和中长期的无依据高紧急度降为中', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.equal(applyDeadlineUrgency(task({ due: '2026-07-21', urgency: '高' }), context).urgency, '中');
  assert.equal(applyDeadlineUrgency(task({ source: '中长期', due: '待确认', urgency: '高' }), context).urgency, '中');
});

test('明确紧迫信号允许未来任务保持高紧急度', () => {
  const result = applyDeadlineUrgency(task({ due: '明天 09:00', urgency: '高' }), {
    now: SHANGHAI_NOON,
    timeZone: 'Asia/Shanghai',
    goalText: '该事项阻塞明天交付，必须尽快完成',
  });
  assert.equal(result.urgency, '高');
});
```

Extend the extraction test so a future task with no signal becomes `中`, while a future task whose source goal contains `阻塞` remains `高`.

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```powershell
& .\.conda\node.exe --test tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js
```

Expected: FAIL because `parseDue` and future/long-term downgrading are not implemented.

- [ ] **Step 3: Implement the minimal policy**

In `server/policies/deadline.js`, add:

```js
const URGENCY_SIGNAL = /紧急|立即|马上|尽快|今天必须|今日必须|当天交付|影响当天交付|阻塞/;
const RELATIVE_DUE_PATTERN = /^(今天|今日|明天)(?:\s*([01]?\d|2[0-3]):([0-5]\d))?$/;

function parseDue(due, context = {}) {
  const explicit = parseExplicitDue(due);
  if (explicit) return explicit;
  return parseRelativeDue(due, context);
}

function hasUrgencySignal(task, goalText = '') {
  return URGENCY_SIGNAL.test([
    task.name,
    task.due,
    task.nextAction,
    ...(task.acceptanceCriteria || []),
    goalText,
  ].filter(Boolean).join('\n'));
}
```

Update `applyDeadlineUrgency` so today/overdue wins first; otherwise future or `source === '中长期'` changes only model `高` without a signal to `中`. Preserve all other fields and do not mutate input.

Use these complete relative-date and override bodies:

```js
function addCalendarDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parseRelativeDue(due, context = {}) {
  if (typeof due !== 'string') return null;
  const match = RELATIVE_DUE_PATTERN.exec(due.trim());
  if (!match) return null;
  const [, relativeDay, hourText, minuteText] = match;
  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  const date = addCalendarDays(referenceDate, relativeDay === '明天' ? 1 : 0);
  const time = hourText == null
    ? null
    : `${String(Number(hourText)).padStart(2, '0')}:${minuteText}`;
  return { date, time, sortKey: `${date}T${time || '23:59'}` };
}

function applyDeadlineUrgency(task, context = {}) {
  const result = { ...task };
  const parsed = parseDue(task?.due, context);
  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  if (parsed && parsed.date <= referenceDate) {
    result.urgency = '高';
    return result;
  }
  const needsEvidence = result.source === '中长期'
    || Boolean(parsed && parsed.date > referenceDate);
  if (needsEvidence && result.urgency === '高'
      && !hasUrgencySignal(result, context.goalText)) {
    result.urgency = '中';
  }
  return result;
}
```

In `server/workflows/extract-tasks.js`, pass:

```js
goalText: validatedGoals[SOURCE_GOAL_KEY[task.source]] || '',
```

Update the extraction prompt to state the same deadline/signal rules and explicitly forbid assigning urgency merely to populate quadrants.

- [ ] **Step 4: Run tests and confirm GREEN**

Run the same command. Expected: all deadline and extraction tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- server/policies/deadline.js server/workflows/extract-tasks.js prompts/system.md tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js
git diff --cached --check
git commit -m "fix: correct unsupported task urgency"
```

### Task 2: Report schedule policy

**Files:**
- Create: `server/policies/report-schedule.js`
- Create: `tests/server/report-schedule.test.js`

- [ ] **Step 1: Write failing focused policy tests**

Cover these public functions:

```js
const {
  buildReportScheduleContext,
  hasScheduleConflict,
  parseEstimatedRangeMinutes,
} = require('../../server/policies/report-schedule');
```

Required assertions:

```js
assert.deepEqual(parseEstimatedRangeMinutes('约1h'), { min: 60, max: 60 });
assert.deepEqual(parseEstimatedRangeMinutes('0.5-1h'), { min: 30, max: 60 });
assert.deepEqual(parseEstimatedRangeMinutes('30分钟'), { min: 30, max: 30 });
assert.equal(parseEstimatedRangeMinutes('半天'), null);
```

Build context for `17:00`/`1h` and `18:00`/`30分钟`, then prove `17:00-18:30 推进方案` conflicts, a non-overlapping range does not, arranging the protected task by its full name does not, and a plain `18:00 前完成` deadline mention is not treated as a range.

- [ ] **Step 2: Run the test and confirm RED**

```powershell
& .\.conda\node.exe --test tests/server/report-schedule.test.js
```

Expected: FAIL because `server/policies/report-schedule.js` does not exist.

- [ ] **Step 3: Implement the policy module**

Create the module with the following complete behavior (factor repeated conversions into local helpers without changing the exported API):

```js
const {
  DEFAULT_TIME_ZONE,
  parseDue,
  referenceDateInTimeZone,
} = require('./deadline');

const TIME_RANGE = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|–|—|至)\s*([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;

function parseEstimatedRangeMinutes(est) {
  if (typeof est !== 'string') return null;
  const text = est.trim().replace(/^约/, '');
  let match = /^(\d+(?:\.\d+)?)\s*(?:-|–|—|至)\s*(\d+(?:\.\d+)?)\s*(?:h|小时)$/i.exec(text);
  if (match) return { min: Number(match[1]) * 60, max: Number(match[2]) * 60 };
  match = /^(\d+(?:\.\d+)?)\s*(?:h|小时)$/i.exec(text);
  if (match) return { min: Number(match[1]) * 60, max: Number(match[1]) * 60 };
  match = /^(\d+(?:\.\d+)?)\s*分钟$/.exec(text);
  if (match) return { min: Number(match[1]), max: Number(match[1]) };
  return null;
}

function minutes(hour, minute) {
  return Number(hour) * 60 + Number(minute);
}

function buildReportScheduleContext({
  tasks,
  now = Date.now,
  timeZone = DEFAULT_TIME_ZONE,
}) {
  const referenceDate = referenceDateInTimeZone(now, timeZone);
  const fixedPoints = [];
  const protectedWindows = [];
  for (const task of tasks) {
    const due = parseDue(task.due, { now, timeZone });
    if (!due?.time || due.date > referenceDate) continue;
    const endMinute = minutes(...due.time.split(':'));
    fixedPoints.push({ taskId: task.id, taskName: task.name, time: due.time, minute: endMinute });
    const estimate = parseEstimatedRangeMinutes(task.est);
    if (!estimate) continue;
    protectedWindows.push({
      taskId: task.id,
      taskName: task.name,
      startMinute: Math.max(0, endMinute - estimate.max),
      endMinute,
      due: due.time,
    });
  }
  return { fixedPoints, protectedWindows };
}

function conflictsWithText(text, scheduleContext) {
  TIME_RANGE.lastIndex = 0;
  for (let match = TIME_RANGE.exec(text); match; match = TIME_RANGE.exec(text)) {
    const start = minutes(match[1], match[2]);
    const end = minutes(match[3], match[4]);
    if (end <= start) continue;
    const constraints = [
      ...scheduleContext.fixedPoints.map(item => ({ ...item, kind: 'point' })),
      ...scheduleContext.protectedWindows.map(item => ({ ...item, kind: 'window' })),
    ];
    for (const constraint of constraints) {
      if (text.includes(constraint.taskName)) continue;
      const overlaps = constraint.kind === 'point'
        ? start <= constraint.minute && constraint.minute < end
        : start < constraint.endMinute && constraint.startMinute < end;
      if (overlaps) return true;
    }
  }
  return false;
}

function hasScheduleConflict(report, scheduleContext) {
  return [...report.energyRules, ...report.adjustments]
    .some(text => conflictsWithText(text, scheduleContext));
}

module.exports = {
  buildReportScheduleContext,
  hasScheduleConflict,
  parseEstimatedRangeMinutes,
};
```

Use explicit range syntax `HH:MM-HH:MM`, including ASCII hyphen, en dash, em dash, and `至`. Derive protected windows only for today or overdue tasks with a parsed time; use the maximum duration for a range so protection is conservative. A collision is invalid only when the recommendation does not name the collided task. Do not persist this context.

- [ ] **Step 4: Run the test and confirm GREEN**

Run the same command. Expected: all schedule-policy tests PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- server/policies/report-schedule.js tests/server/report-schedule.test.js
git diff --cached --check
git commit -m "feat: derive report schedule constraints"
```

### Task 3: Integrate schedule validation with report retry

**Files:**
- Modify: `tests/server/generate-report.test.js`
- Modify: `server/workflows/generate-report.js`
- Modify: `prompts/system.md`

- [ ] **Step 1: Write failing workflow and API tests**

Add a workflow test whose first fake response contains `17:00-18:30 推进方案`, whose second response contains a non-conflicting range, and assert two model calls. Parse the first request and assert it contains `scheduleContext.fixedPoints` and `scheduleContext.protectedWindows`.

Add a repeated-conflict test:

```js
await assert.rejects(
  generateReport({ tasks, matrix, goals, modelClient, now: SHANGHAI_NOON }),
  error => error.code === 'MODEL_OUTPUT_INVALID',
);
assert.equal(modelClient.calls.length, 2);
```

Add an API test that queues two conflicting fake reports and asserts HTTP 502 with only the stable public error shape, not the rejected report text.

- [ ] **Step 2: Run and confirm RED**

```powershell
& .\.conda\node.exe --test tests/server/generate-report.test.js
```

Expected: FAIL because the request lacks `scheduleContext` and conflicting reports are accepted.

- [ ] **Step 3: Integrate the policy**

In `generate-report.js`:

```js
const {
  buildReportScheduleContext,
  hasScheduleConflict,
} = require('../policies/report-schedule');

const scheduleContext = buildReportScheduleContext({
  tasks: input.tasks,
  now: now || Date.now,
  timeZone: 'Asia/Shanghai',
});
```

Send `{ ...input, priorityContext, scheduleContext }` to the fake/real model boundary. After existing semantic checks, call `hasScheduleConflict(report, scheduleContext)` and throw the existing `outputError()` when true so the current two-attempt loop performs exactly one retry.

Update the report prompt to explain `scheduleContext`, require explicit ranges to avoid other tasks' windows/points, and forbid inventing hidden calendar data.

- [ ] **Step 4: Run and confirm GREEN**

Run the same test command. Expected: all report workflow/API tests PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- server/workflows/generate-report.js prompts/system.md tests/server/generate-report.test.js
git diff --cached --check
git commit -m "fix: reject conflicting report schedules"
```

### Task 4: Hide long-term effort in current and history UI

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `tests/auth-history.spec.js`
- Modify: `frontend/app.js`
- Modify: `frontend/history-ui.js`

- [ ] **Step 1: Write failing Playwright assertions**

In the existing long-term current-card test, assert the long-term card does not contain `16h`, and add a normal task with `1h` that still displays it.

In the history fixture, change one task to `source: '中长期'`, retain a unique `est: '长期工时16h'`, add `nextAction`, then assert the history detail omits that unique effort while still showing its due date, acceptance criterion, and next action. Assert a normal task's unique effort remains visible.

- [ ] **Step 2: Run the focused browser tests and confirm RED**

```powershell
& .\.conda\npx.cmd playwright test tests/frontend.spec.js tests/auth-history.spec.js --grep "长期任务卡|历史详情"
```

Expected: FAIL because both renderers currently include long-term `est`.

- [ ] **Step 3: Apply the minimal render filters**

In `frontend/app.js`:

```js
if (task.source !== '中长期' && task.est) tags.push([task.est, '']);
```

In `frontend/history-ui.js`, construct metadata from an array and include `task.est` only when `task.source !== '中长期'`; retain due, criteria, and next action rendering unchanged.

- [ ] **Step 4: Run focused browser tests and confirm GREEN**

Run the same Playwright command. Expected: both selected tests PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- frontend/app.js frontend/history-ui.js tests/frontend.spec.js tests/auth-history.spec.js
git diff --cached --check
git commit -m "fix: hide long-term effort labels"
```

### Task 5: Contract regression and completion gates

**Files:**
- Modify: `docs/agent-plans/2026-07-21-time-assistant-feedback-implementation-plan.md` (checkboxes only)

- [ ] **Step 1: Re-run invariant tests**

```powershell
& .\.conda\node.exe --test tests/server/classify-matrix.test.js tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js tests/server/report-schedule.test.js tests/server/generate-report.test.js
```

Expected: PASS, including single membership, empty quadrants, only `高` mapping, and 55/25/15/5.

- [ ] **Step 2: Run the full suite**

```powershell
& .\.conda\npm.cmd test
```

Expected: server and Playwright suites PASS with fake model configuration only.

- [ ] **Step 3: Run repository gates**

```powershell
git diff --check
git status --short --branch
git hook run pre-commit
git hook run pre-push
```

Expected: no whitespace errors; hooks PASS; only the four pre-existing unrelated untracked paths remain outside this work.

- [ ] **Step 4: Commit plan completion marks**

```powershell
git add -- docs/agent-plans/2026-07-21-time-assistant-feedback-implementation-plan.md
git diff --cached --check
git commit -m "docs: complete time assistant feedback plan"
```

- [ ] **Step 5: Final audit**

Run `git status --short --branch` and `git log --oneline -8`. Report changed files, test counts/results, remaining unrelated files, risks, branch status, and commits. Do not deploy or push.

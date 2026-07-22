# Explicit Task Classification Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every classified task card explicitly show one importance label and one urgency label while keeping unclassified manual tasks undecided.

**Architecture:** Change only the `taskTags()` presentation boundary. Convert the existing high/medium/low values to binary user-facing labels without changing stored task data, APIs, matrix mapping, history, or reports; reuse the existing neutral tag style for negative labels.

**Tech Stack:** Vanilla JavaScript, Playwright, Node.js, project-local Anaconda `.conda` environment.

---

## File map

- Modify `tests/frontend.spec.js`: cover all four binary classification combinations and the unclassified manual-task boundary.
- Modify `frontend/app.js`: emit explicit binary labels for classified tasks.
- Modify this plan document: check each verified step.

### Task 1: Show explicit binary labels on classified task cards

**Files:**
- Modify: `tests/frontend.spec.js:310-378,743-757`
- Modify: `frontend/app.js:358-369`

- [x] **Step 1: Add the failing classified-task card test**

Insert this test after `模型任务名使用行内 Markdown 且不露出标记` in `tests/frontend.spec.js`:

```js
test('已分类任务卡显式展示重要性和紧急度二值标签', async ({ page }) => {
  await advanceToTasks(page);

  const firstQuadrant = page.locator('.task').filter({ hasText: '跟进两个客户投诉' });
  await expect(firstQuadrant.locator('.t.imp')).toHaveText('重要');
  await expect(firstQuadrant.locator('.t.urg')).toHaveText('紧急');
  await expect(firstQuadrant).not.toContainText('不重要');
  await expect(firstQuadrant).not.toContainText('不紧急');

  const secondQuadrant = page.locator('.task').filter({ hasText: '复盘上季度转化缺口原因' });
  await expect(secondQuadrant.locator('.t.imp')).toHaveText('重要');
  await expect(secondQuadrant).toContainText('不紧急');

  const thirdQuadrant = page.locator('.task').filter({ hasText: '校对今天的方案终稿' });
  await expect(thirdQuadrant).toContainText('不重要');
  await expect(thirdQuadrant.locator('.t.urg')).toHaveText('紧急');

  const fourthQuadrant = page.locator('.task').filter({ hasText: '回复非紧急群消息' });
  await expect(fourthQuadrant).toContainText('不重要');
  await expect(fourthQuadrant).toContainText('不紧急');
});
```

- [x] **Step 2: Extend the unclassified manual-task boundary assertions**

In `未标注手动任务在矩阵前后分别显示待 AI 判定和 AI 判定`, replace the first single assertion with:

```js
const unclassifiedTask = page.locator('.task').filter({ hasText: '待判定任务' });
await expect(unclassifiedTask).toContainText('待 AI 判定');
await expect(unclassifiedTask).not.toContainText('不重要');
await expect(unclassifiedTask).not.toContainText('不紧急');
```

After returning from the matrix, append:

```js
await expect(taskRow).toContainText('不重要');
await expect(taskRow).toContainText('不紧急');
```

- [x] **Step 3: Run the focused tests and confirm RED**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe .\node_modules\@playwright\test\cli.js test frontend.spec.js:318 frontend.spec.js:765
```

Expected: FAIL because medium/low classified tasks do not yet render `不重要` or `不紧急`; the unclassified task must still pass the new negative assertions before matrix classification.

- [x] **Step 4: Implement the minimal task-tag mapping**

Replace the first two conditions in `taskTags()` with:

```js
if (task.importance) {
  tags.push(task.importance === '高' ? ['重要', 'imp'] : ['不重要', '']);
}
if (task.urgency) {
  tags.push(task.urgency === '高' ? ['紧急', 'urg'] : ['不紧急', '']);
}
```

Keep `待 AI 判定`, `AI 判定`, source, deadline, and effort logic unchanged.

- [x] **Step 5: Run the focused tests and confirm GREEN**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe .\node_modules\@playwright\test\cli.js test frontend.spec.js:318 frontend.spec.js:765
```

Expected: 2 tests pass, 0 fail.

- [x] **Step 6: Run the complete frontend Playwright file**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\npx.cmd playwright test frontend.spec.js
```

Expected: all tests in `frontend.spec.js` pass.

- [x] **Step 7: Commit the implementation**

```powershell
git add -- frontend/app.js tests/frontend.spec.js docs/agent-plans/2026-07-22-explicit-task-classification-labels-implementation-plan.md
git diff --cached --check
git commit -m "fix: show explicit task classification labels"
```

### Task 2: Full regression and repository gates

**Files:**
- Verify only; do not modify unrelated files.

- [x] **Step 1: Run the complete project suite**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\npm.cmd test
```

Expected: server and Playwright suites exit 0 using fake model configuration.

- [x] **Step 2: Run whitespace and hook checks**

```powershell
git diff --check
git hook run pre-commit
```

Expected: both commands exit 0 without bypassing hooks.

- [x] **Step 3: Review final scope and status**

```powershell
git status --short --branch
git diff --stat
git log -3 --oneline
```

Expected: no tracked working-tree changes remain after commits; pre-existing unrelated untracked files remain untouched.

- [x] **Step 4: Commit the completed execution record**

```powershell
git add -- docs/agent-plans/2026-07-22-explicit-task-classification-labels-implementation-plan.md
git diff --cached --check
git commit -m "docs: complete explicit labels plan"
```

Expected: the completed plan is committed separately; do not create or stage unrelated files.

## Completion evidence

- The focused Playwright tests fail before implementation and pass afterward.
- Classified task cards display exactly one importance and one urgency label.
- Unclassified manual tasks do not display binary labels before AI matrix classification.
- Complete server and Playwright suites pass with fake model configuration.
- `git diff --check`, Git hooks, final status, and English commit history are verified.

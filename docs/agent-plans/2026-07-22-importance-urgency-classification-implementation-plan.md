# Evidence-Based Importance and Urgency Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task importance evidence-based and task urgency deterministically derived from deadlines and explicit pressure, without forcing tasks into every quadrant or changing existing API contracts.

**Architecture:** Keep `importance` as a model-produced semantic label, but define strict high/medium/low evidence in the task extraction prompt. Make `urgency` deterministic at the existing `applyDeadlineUrgency` boundary: today/overdue and explicit pressure are high, parseable future dates within seven days are medium, later dates and unknown long-term deadlines are low, and unparseable non-placeholder deadline text is conservatively medium. Preserve the existing task schema, stable IDs, matrix mapping, 55/25/15/5 policy, and fake-model-only automated tests.

**Tech Stack:** Node.js CommonJS, Node test runner, Ajv, Markdown prompts, Playwright, project-local Anaconda `.conda` environment.

---

## Scope and fixed decisions

- No API, database, frontend, history, account, or task ID changes.
- Only `importance="高"` maps to important; `中/低` remain not important in the matrix.
- Only `urgency="高"` maps to urgent; `中/低` remain not urgent in the matrix.
- Do not force a balanced quadrant distribution. Any quadrant may remain empty.
- Do not add keyword-based backend importance rewriting; importance depends on outcome impact and remains a model judgment.
- Do not call a real model or paid API in automated tests. Use existing fake model clients only.
- `due="待确认"` must not remain high urgency merely because the model returned high.
- A task from the “今天” column with no parseable deadline is treated as high urgency because the user explicitly placed it in today's work; an explicit future deadline takes precedence over the source column.
- Explicit pressure such as “立即、马上、阻塞、影响当天交付” may elevate a future or long-term task to high urgency.

## File map

- Modify `prompts/system.md`: define evidence for importance and align urgency wording with the deterministic policy.
- Modify `server/policies/deadline.js`: implement deterministic urgency tiers without mutating the input task.
- Modify `tests/server/deadline-policy.test.js`: cover deadline tiers, unknown deadlines, explicit pressure, today source, and immutability.
- Modify `tests/server/extract-tasks.test.js`: prove the workflow applies the policy after fake model extraction.
- Modify `tests/server/prompt-contract.test.js`: lock the prompt's importance, urgency, and no-forced-distribution rules.
- Modify `tests/prompt-cases.md`: add human/model semantic evaluation cases without real credentials.

### Task 1: Define evidence-based classification language in the extraction prompt

**Files:**
- Modify: `tests/server/prompt-contract.test.js`
- Modify: `prompts/system.md:62-77`

- [x] **Step 1: Add the failing prompt contract test**

Append this test to `tests/server/prompt-contract.test.js`:

```js
test('任务提取提示词定义重要性证据和紧急度分层且不强制填满象限', () => {
  const source = readFileSync(
    path.join(__dirname, '..', '..', 'prompts', 'system.md'),
    'utf8',
  );

  assert.match(source, /高重要性.*核心目标.*重大风险.*关键决策/s);
  assert.match(source, /中重要性.*支撑.*准备.*协调/s);
  assert.match(source, /低重要性.*常规行政.*通知.*归档/s);
  assert.match(source, /不得因为.*管理.*团队.*项目.*自动判为高重要性/s);
  assert.match(source, /是否可以授权.*不能单独决定重要性/s);
  assert.match(source, /今天或已逾期.*高.*未来\s*7\s*天内.*中.*超过\s*7\s*天.*低/s);
  assert.match(source, /待确认.*没有明确紧急信号.*低/s);
  assert.match(source, /允许任意象限为空.*不得.*填满.*平均分配/s);
});
```

- [x] **Step 2: Run the focused test and confirm RED**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test --test-name-pattern "任务提取提示词定义" tests\server\prompt-contract.test.js
```

Expected: FAIL because `prompts/system.md` does not yet define high/medium/low importance evidence or the full urgency tiers.

- [x] **Step 3: Replace the task-label portion of the extraction prompt**

In `prompts/system.md`, keep the existing task fields and append the following rules immediately after the field list:

```text
【重要性判定】重要性只看“不完成会对目标和结果造成多大影响”，不得按任务语气、职位或关键词猜测。
- 高重要性：直接影响核心目标、关键项目、明确验收结果或对外承诺；不完成会造成明显业务损失或重大风险；属于关键决策、方案审批、风险处置、资源协调；是多项任务继续推进的前置条件；或直接支撑已明确的中长期目标。
- 中重要性：支撑重要目标但不是决定性结果；属于准备、协调、资料整理或阶段性辅助工作；短期延迟会有影响但不会导致核心目标立即失败。
- 低重要性：常规行政、普通通知、转发、归档或非必要格式整理；不完成不会直接影响核心目标；属于可选优化或低影响重复事务。
- 不得因为任务包含“管理、团队、项目”等词就自动判为高重要性。是否可以授权不能单独决定重要性；重要性看结果影响，授权看执行主体。

【紧急度判定】
- 今天或已逾期任务为高；原文明确含“紧急、立即、马上、今天必须、今日必须、当天交付、影响当天交付、阻塞”等近期压力时可以为高。
- 可解析的未来 7 天内期限为中；超过 7 天的期限为低。
- 截止时间为“待确认”且没有明确紧急信号时为低；中长期任务没有明确近期压力时为低。
- “今天”栏中没有可解析期限的当前行动可为高；如果原文给出明确未来期限，则按期限判定。
- 允许任意象限为空，不得为了填满或平均分配四象限而修改重要性或紧急度。
```

Remove the old standalone rule 7 so that the prompt contains one authoritative urgency policy rather than two overlapping versions. Keep all task field names and output JSON unchanged.

- [x] **Step 4: Run the focused prompt contract test and confirm GREEN**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test --test-name-pattern "任务提取提示词定义" tests\server\prompt-contract.test.js
```

Expected: PASS with one matching test and zero failures.

- [x] **Step 5: Run the full prompt contract file**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test tests\server\prompt-contract.test.js
```

Expected: all tests in `prompt-contract.test.js` pass.

- [x] **Step 6: Commit the prompt contract**

```powershell
git add -- prompts/system.md tests/server/prompt-contract.test.js
git diff --cached --check
git commit -m "feat: define task classification evidence"
```

### Task 2: Make deadline urgency deterministic

**Files:**
- Modify: `tests/server/deadline-policy.test.js`
- Modify: `server/policies/deadline.js:97-116`

- [ ] **Step 1: Replace overlapping urgency expectations with one tier table test**

Keep the parsing, timezone, and immutability tests. Replace the current future/unknown urgency tests with this table-driven test:

```js
test('期限、来源和明确压力按统一规则确定紧急度', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  const cases = [
    { name: '当天', input: { source: '复盘', due: '2026-07-20', urgency: '低' }, expected: '高' },
    { name: '逾期', input: { source: '复盘', due: '2026-07-19', urgency: '低' }, expected: '高' },
    { name: '明天', input: { source: '短期目标', due: '2026-07-21', urgency: '低' }, expected: '中' },
    { name: '七天内', input: { source: '短期目标', due: '2026-07-27', urgency: '低' }, expected: '中' },
    { name: '超过七天', input: { source: '短期目标', due: '2026-07-28', urgency: '高' }, expected: '低' },
    { name: '复盘待确认', input: { source: '复盘', due: '待确认', urgency: '高' }, expected: '低' },
    { name: '中长期待确认', input: { source: '中长期', due: '待确认', urgency: '高' }, expected: '低' },
    { name: '今天栏待确认', input: { source: '今天', due: '待确认', urgency: '低' }, expected: '高' },
    { name: '不可解析自然期限', input: { source: '复盘', due: '本周五', urgency: '高' }, expected: '中' },
    { name: '未来但明确阻塞', input: { source: '短期目标', name: '立即处理发布阻塞', due: '2026-07-28', urgency: '低' }, expected: '高' },
  ];

  for (const item of cases) {
    assert.equal(
      applyDeadlineUrgency(task(item.input), context).urgency,
      item.expected,
      item.name,
    );
  }
});
```

Retain the existing separate test proving that urgency signals found in the corresponding original goal text also elevate a future task to high.

- [ ] **Step 2: Run the policy tests and confirm RED**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test tests\server\deadline-policy.test.js
```

Expected: FAIL for future low-to-medium, more-than-seven-days high-to-low, review `待确认` high-to-low, today-source unknown high, and unparseable natural deadline medium.

- [ ] **Step 3: Add the calendar distance helper**

Add this function above `applyDeadlineUrgency` in `server/policies/deadline.js`:

```js
function calendarDayDistance(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
```

- [ ] **Step 4: Replace `applyDeadlineUrgency` with deterministic tiers**

Use this implementation:

```js
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

  if (hasUrgencySignal(result, context.goalText)) {
    result.urgency = '高';
    return result;
  }

  if (parsed) {
    const daysUntilDue = calendarDayDistance(referenceDate, parsed.date);
    result.urgency = daysUntilDue <= 7 ? '中' : '低';
    return result;
  }

  const dueText = typeof result.due === 'string' ? result.due.trim() : '';
  const isUnknown = !dueText || dueText === '待确认';
  if (result.source === '今天' && isUnknown) {
    result.urgency = '高';
  } else if (isUnknown || result.source === '中长期') {
    result.urgency = '低';
  } else {
    result.urgency = '中';
  }
  return result;
}
```

Do not export `calendarDayDistance`; it is an internal helper. Preserve the existing `parseDue`, timezone injection, urgency signal scan, and object immutability behavior.

- [ ] **Step 5: Run the policy tests and confirm GREEN**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test tests\server\deadline-policy.test.js
```

Expected: all parsing, timezone, tier, goal-text signal, and immutability tests pass.

- [ ] **Step 6: Commit the deterministic urgency policy**

```powershell
git add -- server/policies/deadline.js tests/server/deadline-policy.test.js
git diff --cached --check
git commit -m "fix: make task urgency evidence based"
```

### Task 3: Lock workflow-level urgency behavior

**Files:**
- Modify: `tests/server/extract-tasks.test.js`

- [ ] **Step 1: Update the extraction integration test with all relevant sources**

Replace `任务提取后按服务端日期纠偏当天紧急度且不猜测其他期限` with:

```js
test('任务提取后按期限、来源和压力统一纠偏紧急度', async () => {
  const result = await extractTasks({
    goals: goals({
      昨天: '复盘改进截止待确认；另有本周五完成的协调事项',
      今天: '今天处理当前行动',
      明天: '明天提交短期方案',
      后天: '未来推进长期机制建设',
    }),
    now: () => new Date('2026-07-20T04:00:00.000Z'),
    modelClient: queuedModel([{ tasks: [
      modelTask({ name: '处理当前行动', source: '今天', due: '待确认', urgency: '低' }),
      modelTask({ name: '落实复盘改进', source: '复盘', due: '待确认', urgency: '高' }),
      modelTask({ name: '完成协调事项', source: '复盘', due: '本周五', urgency: '高' }),
      modelTask({ name: '提交短期方案', source: '短期目标', due: '明天', urgency: '低', acceptanceCriteria: ['方案已提交'] }),
      modelTask({ name: '建设长期机制', source: '中长期', due: '2026-09-30', urgency: '高', acceptanceCriteria: ['机制已试运行'] }),
    ] }]),
  });

  assert.deepEqual(result.tasks.map(item => item.urgency), [
    '高',
    '低',
    '中',
    '中',
    '低',
  ]);
});
```

- [ ] **Step 2: Run the focused extraction test**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test --test-name-pattern "统一纠偏紧急度" tests\server\extract-tasks.test.js
```

Expected: PASS because Task 2 already implemented the policy. If it fails, fix only the policy/workflow boundary demonstrated by the failure; do not weaken the assertions.

- [ ] **Step 3: Run the complete extraction workflow tests**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test tests\server\extract-tasks.test.js
```

Expected: all extraction tests pass. Update any older assertion only when it conflicts with the approved tier table; retain stable IDs, completed-fact filtering, SMART criteria, retry, size, and API boundary assertions.

- [ ] **Step 4: Commit the workflow regression**

```powershell
git add -- tests/server/extract-tasks.test.js
git diff --cached --check
git commit -m "test: cover task urgency tiers"
```

### Task 4: Add human/model classification evaluation cases

**Files:**
- Modify: `tests/server/prompt-contract.test.js`
- Modify: `tests/prompt-cases.md:18-29`

- [ ] **Step 1: Write the failing documentation contract test**

Append this test to `tests/server/prompt-contract.test.js`:

```js
test('人工提示词用例覆盖重要性证据、紧急度分层和空象限', () => {
  const source = readFileSync(path.join(__dirname, '..', 'prompt-cases.md'), 'utf8');
  assert.match(source, /核心目标.*高重要性/s);
  assert.match(source, /准备或协调.*中重要性/s);
  assert.match(source, /通知或归档.*低重要性/s);
  assert.match(source, /待确认.*无紧急信号.*低紧急度/s);
  assert.match(source, /未来\s*7\s*天内.*中紧急度/s);
  assert.match(source, /允许.*象限为空.*不强制.*平均/s);
  assert.match(source, /不得调用真实付费 API/);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test --test-name-pattern "人工提示词用例覆盖" tests\server\prompt-contract.test.js
```

Expected: FAIL because the existing Step 2 table does not cover the new classification evidence.

- [ ] **Step 3: Add the classification cases to `tests/prompt-cases.md`**

Extend the Step 2 table with these rows:

```markdown
| 8 | “审核关键项目验收方案，不完成将阻塞项目交付” | importance=高 | 直接影响核心目标、关键验收和后续交付，具有高重要性证据 |
| 9 | “整理关键项目评审所需的背景资料” | importance=中 | 准备或协调类工作支撑目标但不是决定性结果，属于中重要性 |
| 10 | “归档已完成审批的普通材料” | importance=低 | 通知或归档类常规事务不直接影响核心目标，属于低重要性 |
| 11 | 复盘改进任务，due=待确认，原文无紧急信号 | urgency=低 | 待确认且无紧急信号时为低紧急度，不保留模型的高标签 |
| 12 | 明确期限在未来 7 天内且无当天压力 | urgency=中 | 近期但不需要当天处理，归为中紧急度 |
| 13 | 期限超过 7 天或中长期目标且无近期压力 | urgency=低 | 长期事项不因重要而自动变成紧急 |
| 14 | 混合任务没有第三或第四象限 | 保持真实分类 | 允许任意象限为空，不强制填满或平均分配 |
```

After the table add this boundary note:

```markdown
分类自然语言质量仅进行人工/模型评测，自动化测试只验证提示词规则、服务端紧急度政策和 JSON 契约。自动化测试使用假模型，不得调用真实付费 API；若用户自行选择真实模型复测，只使用虚构内容并记录模型名称、日期和失败样例。
```

- [ ] **Step 4: Run the focused and complete prompt contract tests**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\node.exe --test --test-name-pattern "人工提示词用例覆盖" tests\server\prompt-contract.test.js
& .\.conda\node.exe --test tests\server\prompt-contract.test.js
```

Expected: both commands exit 0 and the complete file has zero failures.

- [ ] **Step 5: Commit the evaluation cases**

```powershell
git add -- tests/prompt-cases.md tests/server/prompt-contract.test.js
git diff --cached --check
git commit -m "test: document classification evaluation cases"
```

### Task 5: Full regression and repository gates

**Files:**
- Verify only; do not add unrelated files.

- [ ] **Step 1: Run the complete server test suite**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\npm.cmd run test:server
```

Expected: exit 0 with no failed tests.

- [ ] **Step 2: Run the complete project suite**

```powershell
$env:PATH = "$PWD\.conda;$env:PATH"
& .\.conda\npm.cmd test
```

Expected: server and Playwright suites both exit 0. The Playwright environment continues to use the configured fake model values; no paid API call is made.

- [ ] **Step 3: Run whitespace and hook checks**

```powershell
git diff --check
git hook run pre-commit
```

Expected: both commands exit 0. Do not bypass or modify hooks.

- [ ] **Step 4: Review the final change scope**

```powershell
git status --short --branch
git diff --stat
git diff -- prompts/system.md server/policies/deadline.js tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js tests/server/prompt-contract.test.js tests/prompt-cases.md
```

Expected: only the six planned implementation files are modified, plus any pre-existing unrelated untracked files that remain untouched.

- [ ] **Step 5: Commit any final verified adjustment**

Only when Task 5 required an additional in-scope correction:

```powershell
git add -- prompts/system.md server/policies/deadline.js tests/server/deadline-policy.test.js tests/server/extract-tasks.test.js tests/server/prompt-contract.test.js tests/prompt-cases.md
git diff --cached --check
git commit -m "test: verify classification policy"
```

If Task 5 required no correction, do not create an empty commit.

## Completion evidence

The implementation is complete only when all of the following have fresh evidence:

- Focused tests were observed failing before the corresponding prompt or policy implementation.
- The same focused tests pass after the minimal implementation.
- Full server tests pass.
- Full Playwright tests pass using fake model configuration.
- `git diff --check` passes.
- The configured pre-commit hook passes.
- `git status --short --branch` shows no accidental staging or modification of unrelated files.
- Commit history contains small English commits for the prompt contract, policy, workflow regression, and evaluation documentation.

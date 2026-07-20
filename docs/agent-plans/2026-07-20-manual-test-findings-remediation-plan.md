# 时间管理助手人工测试问题修复实施计划

> **执行要求：** 必须使用 `executing-plans` 按本计划逐项执行；禁止创建子 Agent 或改用多 Agent。每个任务均使用 TDD（test-driven development，测试驱动开发）：先写失败测试并确认按预期失败，再完成最小实现并验证通过。每完成一个任务，立即勾选对应检查项并进行一次英文小步提交。

**目标：** 修复 2026-07-20 人工测试中暴露的截止时间紧急度误判、报告顺序失真、到期任务被建议延后、任务粒度过粗以及 SMART 验收标准丢失问题，同时保持既有正式契约和现有交互不变。

**架构：** 在任务提取 workflow 后增加纯函数式的截止时间与任务质量策略，在报告生成 workflow 前计算确定性的优先级上下文，再由模型只生成解释性文字。通过 `now` 依赖注入固定测试日期，生产环境仍使用服务端当前时间，外部 API 不接受客户端伪造的参考日期。矩阵继续只根据既有标签分类，不负责修正非空标签。

**技术栈：** Node.js 20、Express 5、Ajv、原生 `node:test`、Playwright 1.60、原生 `Intl.DateTimeFormat`；项目专用 Anaconda 环境为 `.conda`，所有模型测试使用假模型。

---

## 一、人工测试结论与修复边界

### 已确认正常，不应修改

- `overall=need_fix` 会阻止进入任务提取；修改或采纳建议后必须重新检查到 `overall=pass`。
- 信息不足仅在对应输入框下展示 `issue`、`suggestion` 和“采纳建议”，不新增聊天式追问。
- 手动任务允许保存 `importance=null`、`urgency=null`，矩阵阶段由 AI 补齐并显示“AI 判定”。
- 任务使用稳定 ID；截止时间缺失显示“待确认”。
- 只有“高”映射为重要或紧急；精力比例固定为 55/25/15/5。
- 已完成复盘事实不生成待办，明确的后续改进行动可以生成待办。
- 第三象限为空是合法结果，不应为了填满象限而伪造任务。

### 本次人工测试暴露的问题

1. 明确在当天 16:00、17:00、18:00 截止的任务被提取为“中/低紧急度”，随后错误进入第二或第四象限。
2. 矩阵严格保留提取标签，因此提取阶段的误判会原样传播；矩阵本身符合正式契约。
3. 报告没有确定性截止时间排序，出现 16:00 任务排在 17:00 任务之后。
4. 报告建议推迟或取消当天 18:00 截止的会议纪要，存在真实误期风险。
5. 12h、16h 的复合任务粒度过粗，缺少可立即执行的下一步。
6. 原始 SMART 内容中的“4 个模块、2 次模拟、评分不低于 80 分”等验收条件没有进入任务卡。
7. 自动化测试主要覆盖 JSON 结构和固定契约，没有覆盖上述业务语义。
8. 稳定 ID 已存在于 DOM 的 `data-task-id` 和服务端响应中；无需在界面暴露 UUID，只需补充端到端映射测试。
9. 矩阵纵轴使用整体 `rotate(180deg)`，导致顶部“重要”和底部“不重要”的汉字阅读顺序颠倒；现有测试只检查 DOM 文本数组，无法发现实际视觉方向错误。
10. 报告模型能读取完整任务 UUID，并在 `energyRules`、`adjustments` 等用户可见文字中输出了 `9a38e8c3` 一类 8 位 UUID 前缀；前端原样渲染模型字符串，造成无业务意义的内部 ID 泄漏到页面和复制内容。

### 明确不在本计划范围内

- 不改变目标检查的阻断流程和字段级反馈交互。
- 不允许矩阵 AI 改写 `ai-extraction` 或 `manual` 的非空标签。
- 不新增账号、数据库、历史记录、跨会话记忆、教练助手依赖、外部平台集成或部署。
- 不调用真实 DeepSeek/OpenAI 等付费 API，不读取或输出真实 `.env`、API key、token 或密码。
- 不全局禁止“推迟/取消”措辞；仅保护已过期或当天到期的具体任务，第四象限无明确期限事项仍可被建议减少或推迟。

## 二、执行前工作区保护

开始实施前必须运行：

```powershell
git status --short --branch
git diff -- .gitignore README.md
git ls-files --others --exclude-standard
```

当前已知、必须视为用户已有改动且不得覆盖、回滚或混入修复提交的文件：

- `.gitignore`
- `README.md`
- `.gitattributes`
- `start.bat`
- `tests/server/start-script.test.js`
- `docs/superpowers/`

本计划文档本身属于本次获准生成的交付物，可以随修复计划更新复选框；除它以外，提交时必须逐个列出修复文件，禁止使用 `git add .`、`git add -A` 或其他会混入上述改动的命令。

后端运行方式已经确认使用项目专用 Anaconda 环境 `.conda`。不得使用全局 Python；Node 命令应在激活 `.conda` 后运行：

```powershell
conda activate "D:\codex-pj\time\.conda"
node --version
npm --version
```

不得重新安装依赖，除非测试证明依赖缺失且先征得用户确认。

---

## Task 1：固化人工测试回归样例和失败基线

**文件：**

- 修改：`tests/prompt-cases.md`
- 新建：`tests/fixtures/manual-test-2026-07-20.js`
- 修改：`tests/server/prompt-contract.test.js`

### 步骤

- [x] 将本次四字段输入、12 条期望任务要点和日期基准 `2026-07-20` 写入纯测试 fixture；不得包含真实模型输出凭据或任何密钥。
- [x] 在 `tests/prompt-cases.md` 增加“2026-07-20 人工业务回归”章节，记录五类失败：当天截止紧急度、报告排序、禁止延后、任务粒度、SMART 验收条件。
- [x] 先在 `tests/server/prompt-contract.test.js` 增加失败断言，要求人工评测文档明确写出模型名、评测日期、参考时区、通过项和失败样例，并运行：

```powershell
node --test tests/server/prompt-contract.test.js
```

预期：新增断言失败，原因是评测文档尚未包含新的回归章节或必需字段。

- [x] 完成 fixture 和文档最小修改后再次运行同一命令，预期全部通过。
- [x] 勾选 Task 1 并提交：

```powershell
git add tests/prompt-cases.md tests/fixtures/manual-test-2026-07-20.js tests/server/prompt-contract.test.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "test: capture manual time management regressions"
```

---

## Task 2：实现可测试的截止时间策略

**文件：**

- 新建：`server/policies/deadline.js`
- 新建：`tests/server/deadline-policy.test.js`

### 策略契约

- 仅解析模型正式输出的 `YYYY-MM-DD` 和 `YYYY-MM-DD HH:mm`；允许日期与时间之间为一个空格或 `T`。
- 使用 `Asia/Shanghai` 将注入的 `now()` 转换为参考日期。
- 截止日期早于或等于参考日期时，`urgency` 必须归一化为“高”。
- `due="待确认"`、空值和无法可靠解析的自然语言期限保持原模型紧急度，不猜测日期。
- 该纯函数不得改变 `id`、`importance`、`classificationSource` 或其他字段。

### 步骤

- [x] 先写失败单元测试，至少覆盖：当天有时间、当天仅日期、已逾期、未来日期、“待确认”、不可解析期限、时区跨日和输入对象不被修改。
- [x] 运行并确认因模块不存在或行为未实现而失败：

```powershell
node --test tests/server/deadline-policy.test.js
```

- [x] 最小实现 `referenceDateInTimeZone(now, timeZone)`、`parseExplicitDue(due)` 和 `applyDeadlineUrgency(task, context)`；不引入新依赖。
- [x] 重跑该测试，预期全部通过。
- [x] 勾选 Task 2 并提交：

```powershell
git add server/policies/deadline.js tests/server/deadline-policy.test.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "feat: normalize urgency for due tasks"
```

---

## Task 3：在任务提取后应用日期纠偏，不修改矩阵契约

**文件：**

- 修改：`server/workflows/extract-tasks.js`
- 修改：`server/app.js`
- 修改：`tests/server/extract-tasks.test.js`
- 修改：`tests/server/classify-matrix.test.js`

### 步骤

- [x] 先增加失败测试：固定 `now()` 为 `2026-07-20T04:00:00.000Z`，断言 `2026-07-20 17:00` 被归一化为“高”，未来日期和“待确认”不变。
- [x] 增加 API 级失败测试，确认 `createApp({ now })` 会把服务端时钟传给提取 workflow；请求体不得新增 `referenceDate`。
- [x] 增加矩阵回归测试：纠偏后的“高”可以进入第一/第三象限，但矩阵仍拒绝修改任何已有非空标签。
- [x] 运行并确认新增测试失败：

```powershell
node --test tests/server/extract-tasks.test.js tests/server/classify-matrix.test.js
```

- [x] 在 `extractTasks` 完成 schema 和语义校验、生成稳定 ID 后应用 `applyDeadlineUrgency`。
- [x] 给 `createApp` 增加仅供依赖注入的 `now` 选项，默认值仍为服务端真实当前时间；不要把参考日期暴露为客户端参数。
- [x] 重跑上述测试，预期全部通过。
- [x] 勾选 Task 3 并提交：

```powershell
git add server/workflows/extract-tasks.js server/app.js tests/server/extract-tasks.test.js tests/server/classify-matrix.test.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "fix: apply deadline urgency after extraction"
```

---

## Task 4：建立确定性的报告候选顺序

**文件：**

- 新建：`server/policies/report-priority.js`
- 新建：`tests/server/report-priority.test.js`

### 排序契约

报告候选顺序由服务端按稳定 ID 计算，不交给模型自由重排：

1. 第一象限按明确截止时间从早到晚；无明确期限排在同象限有期限任务之后。
2. 已逾期或当天到期的第三象限按截止时间排序，紧随第一象限，行动语义为“立即授权”。
3. 第二象限按明确截止时间从早到晚；无明确期限排后。
4. 其余第三象限按期限排序。
5. 第四象限最后，按明确期限再按原输入顺序。
6. 完全同序时使用原任务数组下标稳定排序，不使用任务名称或随机 ID 排序。
7. `order` 取前 `min(5, tasks.length)` 条；当天/逾期但未进入前五的任务进入 `remainingProtectedTaskIds`。

### 步骤

- [x] 先写失败测试，覆盖 16:00 早于 17:00、当天第三象限早于未来第二象限、未知期限靠后、同期限保持输入顺序、任务不足五条和超过五条。
- [x] 运行并确认失败：

```powershell
node --test tests/server/report-priority.test.js
```

- [x] 最小实现 `buildReportPriorityContext({ tasks, matrix, now, timeZone })`，返回 `recommendedTaskIds`、`protectedTaskIds`、`remainingProtectedTaskIds` 和每条任务的行动类型。
- [x] 重跑测试，预期全部通过。
- [x] 勾选 Task 4 并提交：

```powershell
git add server/policies/report-priority.js tests/server/report-priority.test.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "feat: compute deterministic report priority"
```

---

## Task 5：约束报告顺序并保护当天到期任务

**文件：**

- 修改：`server/workflows/generate-report.js`
- 修改：`server/app.js`
- 修改：`prompts/system.md`
- 修改：`tests/server/generate-report.test.js`
- 修改：`tests/server/prompt-contract.test.js`

### 报告硬规则

- 模型返回的 `order[].taskId` 必须与服务端 `recommendedTaskIds` 完全同序，否则按现有机制重试一次，仍错误则返回 `MODEL_OUTPUT_INVALID`。
- 报告提及调整某条任务时必须使用完整任务名，便于服务端做低误报校验。
- 对 `protectedTaskIds` 对应的完整任务名，不允许在同一条 `reason`、`energyRules` 或 `adjustments` 中出现“推迟、延后、取消、暂缓、搁置”等动作。
- 当 `remainingProtectedTaskIds` 非空时，`adjustments` 必须逐条包含完整任务名，并给出当天明确时间安排或“立即授权”；不能静默遗漏。
- 第三象限当天任务的建议必须包含“授权、委派、交办”之一。
- 第四象限无明确期限任务仍可建议减少、推迟或取消，不做全局关键词封禁。

### 步骤

- [x] 先写失败测试：模型第一次返回 17:00 在 16:00 之前，第二次返回正确顺序，断言发生一次重试。
- [x] 写失败测试：模型建议延后当天任务时被拒绝；建议延后无期限第四象限任务时被接受。
- [x] 写失败测试：当天第三象限没有授权语义时重试；超过五条当天任务时，剩余任务必须出现在调整建议中。
- [x] 更新 prompt 契约测试，要求系统提示明确包含上述顺序和保护规则。
- [x] 运行并确认新增测试失败：

```powershell
node --test tests/server/generate-report.test.js tests/server/prompt-contract.test.js
```

- [x] 在 `generateReport` 内部构造 `priorityContext` 并随模型 user JSON 传入；外部 HTTP 请求和最终响应三段结构保持不变。
- [x] 实现精确任务名范围内的禁用动作校验，不使用会误伤第四象限的全局关键词检查。
- [x] 把 `now` 从 `createApp` 传入 `generateReport`，生产默认值不变。
- [x] 重跑上述测试，预期全部通过。
- [x] 勾选 Task 5 并提交：

```powershell
git add server/workflows/generate-report.js server/app.js prompts/system.md tests/server/generate-report.test.js tests/server/prompt-contract.test.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "fix: enforce deadline-aware report guidance"
```

---

## Task 6：保存并展示 SMART 验收标准

**文件：**

- 修改：`server/contracts/time-management.js`
- 修改：`server/workflows/extract-tasks.js`
- 修改：`prompts/system.md`
- 修改：`frontend/app.js`
- 修改：`frontend/index.html`
- 修改：`tests/server/contracts.test.js`
- 修改：`tests/server/extract-tasks.test.js`
- 修改：`tests/frontend.spec.js`

### 数据契约

- 为任务增加 `acceptanceCriteria: string[]`，标准化缺省值为 `[]`，最多 5 条，每条 1–200 个字符。
- `短期目标` 和 `中长期` 来源的 AI 提取任务至少需要 1 条验收标准；其他来源允许空数组。
- 手动任务默认 `acceptanceCriteria: []`，不新增必填输入，不破坏当前手动添加流程。
- 任务卡仅在数组非空时展示“完成标准”，使用安全 DOM API 或既有受控 Markdown 渲染，不拼接未转义 HTML。

### 步骤

- [x] 先增加服务端失败测试：保留“4 个模块、2 次模拟、评分不低于 80 分”，缺少中短期验收标准时触发重试，普通今天任务允许空数组。
- [x] 增加 Playwright 失败测试：任务卡显示三条验收标准，恶意 HTML 不执行，手动任务仍可正常添加。
- [x] 运行并确认新增测试失败：

```powershell
node --test tests/server/contracts.test.js tests/server/extract-tasks.test.js
npx playwright test tests/frontend.spec.js --grep "完成标准|手动任务"
```

- [x] 扩展 schema、标准化函数、提取提示词和任务卡渲染；同步更新所有受影响的假模型 fixture。
- [x] 重跑上述测试，预期全部通过。
- [x] 勾选 Task 6 并提交：

```powershell
git add server/contracts/time-management.js server/workflows/extract-tasks.js prompts/system.md frontend/app.js frontend/index.html tests/server/contracts.test.js tests/server/extract-tasks.test.js tests/frontend.spec.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "feat: preserve task acceptance criteria"
```

---

## Task 7：控制任务粒度并提供立即下一步

**文件：**

- 修改：`server/contracts/time-management.js`
- 修改：`server/workflows/extract-tasks.js`
- 修改：`prompts/system.md`
- 修改：`frontend/app.js`
- 修改：`frontend/index.html`
- 修改：`tests/server/contracts.test.js`
- 修改：`tests/server/extract-tasks.test.js`
- 修改：`tests/frontend.spec.js`

### 粒度契约

- 增加 `nextAction: string`，缺省为 `""`，最大 200 个字符。
- 仅对可可靠解析的 `h`、`小时`、`分钟`耗时执行确定性规则；不可解析文本保留，不猜测。
- `复盘`、`今天`、`短期目标`、`临时`来源的单条任务超过 8h 时判定模型输出无效，要求模型拆分。
- `中长期`里程碑允许超过 8h，但必须提供非空 `nextAction`，把大目标落成可立即执行的动作。
- 任务卡仅在 `nextAction` 非空时展示“下一步”；手动任务默认空字符串。

### 步骤

- [x] 先写失败单元测试，覆盖 `20分钟`、`0.5h`、`8h`、`12h`、不可解析耗时；断言今天 12h 被拒绝，中长期 16h 有下一步时被接受、无下一步时被拒绝。
- [x] 写 Playwright 失败测试，断言长期任务卡展示“下一步”，普通任务不显示空区域。
- [x] 运行并确认新增测试失败：

```powershell
node --test tests/server/contracts.test.js tests/server/extract-tasks.test.js
npx playwright test tests/frontend.spec.js --grep "下一步|长期任务"
```

- [x] 实现纯函数 `parseEstimatedMinutes(est)`、schema/语义校验、提示词约束和安全 UI 渲染；不做基于自然语言的自动拆分，避免服务端伪造任务。
- [x] 重跑上述测试，预期全部通过。
- [x] 勾选 Task 7 并提交：

```powershell
git add server/contracts/time-management.js server/workflows/extract-tasks.js prompts/system.md frontend/app.js frontend/index.html tests/server/contracts.test.js tests/server/extract-tasks.test.js tests/frontend.spec.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "feat: enforce actionable task granularity"
```

---

## Task 8：修正矩阵纵轴文字方向

**文件：**

- 修改：`frontend/index.html`
- 修改：`tests/frontend.spec.js`

### UI 契约

- 纵轴顶部显示“重要”，底部显示“不重要”，两个词均按正常的从上到下汉字顺序阅读，不得倒置或旋转 180 度。
- 横轴仍保持左侧“不紧急”、右侧“紧急”。
- 四象限 DOM 顺序仍为 `q2、q1、q4、q3`，不得通过交换象限解决轴标签问题。
- 桌面端和 375px 窄屏端均不得与矩阵卡片重叠、裁切或溢出。
- DOM 文本和无障碍可读名称保持“重要”“不重要”，不得拆成反向字符或使用伪元素伪造文字。

### 步骤

- [x] 在 `tests/frontend.spec.js` 现有矩阵方向测试中增加视觉布局失败断言：顶部标签的 `boundingBox().y` 小于底部标签，计算样式不得包含 180 度旋转，两个标签使用正常的竖排直立文字方向。
- [x] 增加 375×812 窄屏回归断言：两个纵轴标签完整位于 `.matrix-wrap` 边界内，且不与任一 `.quad` 的边界相交。
- [x] 运行并确认新增断言在当前 `.axis-y{ transform:rotate(180deg) }` 下按预期失败：

```powershell
npx playwright test tests/frontend.spec.js --grep "矩阵方向|纵轴文字"
```

- [x] 最小修改 `.axis-y`：移除整个纵轴容器的 180 度旋转，使用明确的纵向 flex 布局固定上下位置，并在标签元素上设置 `writing-mode: vertical-rl` 与 `text-orientation: upright`；不要改动象限数据或矩阵业务逻辑。
- [x] 重跑上述定向测试，预期桌面端与窄屏断言全部通过。
- [x] 运行完整前端回归，确认矩阵、报告和窄屏布局未受影响：

```powershell
npm run test:e2e
```

- [x] 勾选 Task 8 并提交：

```powershell
git add frontend/index.html tests/frontend.spec.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "fix: correct matrix vertical axis labels"
```

---

## Task 9：禁止内部任务 ID 出现在用户可见报告中

**文件：**

- 修改：`server/workflows/generate-report.js`
- 修改：`prompts/system.md`
- 修改：`frontend/app.js`
- 修改：`tests/server/generate-report.test.js`
- 修改：`tests/server/prompt-contract.test.js`
- 修改：`tests/frontend.spec.js`

### 可见性契约

- 完整任务 ID 只允许存在于结构化字段：任务对象的 `id`、矩阵的 `taskIds`、分类及报告顺序的 `taskId`；这些字段继续承担同名任务关联和稳定引用职责。
- 用户可见的 `order[].reason`、`energyRules[]`、`adjustments[]`、渲染后的报告正文和“复制报告”内容不得包含完整任务 ID。
- 对 UUID 格式的任务 ID，用户可见文字也不得包含该 ID 的前 8 位或更长前缀，例如 `9a38e8c3`。
- 服务端只能与当前输入任务的真实 ID 及其 UUID 前缀逐项比较；不得使用全局“8 位十六进制字符串”禁令，以免误伤合法业务编号。
- 检测到泄漏时按现有模型输出异常机制重试一次；第二次仍泄漏则返回 `MODEL_OUTPUT_INVALID`，不得把脏输出交给前端。
- 前端必须用 `taskId` 查找任务名称；查找失败时走既有“任务数据已变化，请重新生成报告”错误流程，不得回退显示原始 ID。

### 步骤

- [x] 在 `tests/server/generate-report.test.js` 先写失败测试：模型第一次在 `energyRules` 返回当前任务 UUID 的前 8 位、第二次返回纯业务文字，断言发生一次重试且最终结果不含 ID。
- [x] 再覆盖完整 UUID、9 位以上 UUID 前缀，以及 `order[].reason`、`energyRules[]`、`adjustments[]` 三个位置；连续两次泄漏必须返回 `MODEL_OUTPUT_INVALID`。
- [x] 增加不误伤测试：`11:00`、`55%`、`2026-07-20`、`不少于10个案例` 和不属于任何当前任务的普通业务编号均可通过。
- [x] 在 `tests/server/prompt-contract.test.js` 增加失败断言，要求报告 Prompt 明确说明“taskId 只写入结构化 taskId 字段，任何用户可见字符串不得复述完整 ID 或其前缀”。
- [x] 在 `tests/frontend.spec.js` 增加失败回归：使用固定 UUID `9a38e8c3-1111-4111-8111-111111111111`，断言报告页面和剪贴板文本均不包含 `9a38e8c3` 或完整 UUID；未知 `taskId` 仍显示既有重新生成提示，而不是把 ID 渲染出来。
- [x] 运行并确认新增测试按预期失败：

```powershell
node --test tests/server/generate-report.test.js tests/server/prompt-contract.test.js
npx playwright test tests/frontend.spec.js --grep "内部任务 ID|复制报告"
```

- [x] 在 `generate-report.js` 实现纯函数 `containsTaskIdLeak(text, tasks)`：对每个当前任务比较完整 ID；仅当 ID 符合标准 UUID 格式时，再比较其前 8 位前缀。将它应用于全部 `reason`、`energyRules` 和 `adjustments` 字符串。
- [x] 更新 `prompts/system.md`，明确 ID 只用于 JSON 关联，面向用户的原因和建议必须使用完整任务名称，不得附带 ID、UUID 或缩写。
- [x] 删除 `reportMarkdown()` 中 `taskById.get(item.taskId)?.name || item.taskId` 的原始 ID 回退；找不到任务名称时必须由现有 `validateReport()` 在渲染前拒绝响应。
- [x] 重跑定向测试，预期全部通过；随后运行完整服务端和前端回归：

```powershell
npm run test:server
npm run test:e2e
```

- [x] 勾选 Task 9 并提交：

```powershell
git add server/workflows/generate-report.js prompts/system.md frontend/app.js tests/server/generate-report.test.js tests/server/prompt-contract.test.js tests/frontend.spec.js docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "fix: prevent task IDs from leaking into reports"
```

---

## Task 10：补齐端到端业务回归与稳定 ID 证据

**文件：**

- 修改：`tests/frontend.spec.js`
- 修改：`tests/server/prompt-contract.test.js`
- 修改：`tests/prompt-cases.md`

### 步骤

- [x] 使用 Task 1 的 fixture 增加完整假模型 E2E：目标检查通过 → 提取 12 条任务 → 矩阵 → 报告。
- [x] 断言四个人工测试关键任务归类正确：重要且当天到期进入第一象限，不重要且当天到期进入第三象限。
- [x] 断言报告中 16:00 在 17:00 之前，第三象限建议包含授权语义，当天任务没有延后/取消建议。
- [x] 断言 12 个服务端稳定 ID 在任务卡 `data-task-id`、矩阵 `taskIds` 和报告 `order.taskId` 中一致；同时断言报告正文和复制内容不显示 UUID 或其 8 位前缀。
- [x] 断言精力比例仍为 55/25/15/5，空第三象限仍可正常渲染。
- [x] 先让至少一个断言因未接入新 fixture 而失败，再完成最小测试路由与 fixture 接入。
- [x] 运行：

```powershell
npx playwright test tests/frontend.spec.js --grep "人工业务回归"
node --test tests/server/prompt-contract.test.js
```

预期：全部通过，且没有真实网络模型调用。

- [x] 勾选 Task 10 并提交：

```powershell
git add tests/frontend.spec.js tests/server/prompt-contract.test.js tests/prompt-cases.md docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "test: cover deadline-aware workflow end to end"
```

---

## Task 11：阶段回归、文档同步和人工复测说明

**文件：**

- 修改：`tests/prompt-cases.md`
- 修改：`docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md`

### 步骤

- [x] 运行全部服务端测试：

```powershell
npm run test:server
```

- [x] 运行全部 Playwright 测试：

```powershell
npm run test:e2e
```

- [x] 不修改当前已有用户改动的 `README.md`；在 `tests/prompt-cases.md` 写明参考时区、当天截止纠偏、完成标准、下一步字段、人工复测步骤和期望观察点。
- [x] 不自动调用付费 API。人工复测由用户自行决定是否使用真实模型。
- [x] 重跑文档契约测试：

```powershell
node --test tests/server/delivery-docs.test.js tests/server/prompt-contract.test.js
```

- [x] 勾选 Task 11 并提交：

```powershell
git add tests/prompt-cases.md docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "docs: document semantic workflow safeguards"
```

---

## Task 12：完整验证、Hooks 和最终状态审计

### 步骤

- [x] 激活项目专用 `.conda`，确认未使用全局 Python，且测试没有真实模型网络调用。
- [x] 运行完整测试：

```powershell
npm test
```

- [x] 运行差异检查：

```powershell
git diff --check
git diff --cached --check
```

- [x] 检查 Git hooks（钩子）配置并执行项目实际存在的 hooks；不得修改、禁用或使用 `--no-verify` 绕过：

```powershell
git config --get core.hooksPath
Get-ChildItem .git\hooks -File
```

如果项目存在可执行 `pre-commit`，通过一次正常提交触发；如果没有自定义 hook，记录“未配置自定义 Git hooks”，不要声称运行了不存在的检查。

- [x] 审计敏感信息与提交范围，只检查变量名和文件名，不读取 `.env` 值：

```powershell
git status --short --branch
git diff --stat
git log --oneline --decorate -12
```

- [x] 确认启动脚本相关既有改动仍保持原状，未被纳入本计划提交。
- [x] 勾选 Task 12；若勾选本身形成最后一个文档改动，单独提交：

```powershell
git add docs/agent-plans/2026-07-20-manual-test-findings-remediation-plan.md
git diff --cached --check
git commit -m "docs: complete manual regression remediation plan"
```

- [x] 不部署。除非用户在新对话明确要求，否则不 push。

---

## 三、完成标准

只有同时满足以下条件才能声称完成：

- [x] 所有 Task 1–12 均已按 TDD 完成并勾选。
- [x] 明确当天或已逾期的 AI 提取任务统一为 `urgency="高"`；“待确认”和不可解析日期不被猜测。
- [x] 矩阵仍只把“高”映射为重要或紧急，且不改写已有人工/提取标签。
- [x] 报告顺序可由服务端确定性复现，16:00 必须早于 17:00。
- [x] 当天或逾期任务不会被建议推迟、延后、取消、暂缓或搁置。
- [x] 当天第三象限任务获得授权/委派建议；超过五条的当天任务不会从报告中静默消失。
- [x] 中短期 SMART 任务保留可见验收标准；超过 8h 的中长期任务显示明确下一步。
- [x] 稳定任务 ID 继续用于结构化关联，但报告页面、模型可见文字字段和复制内容均不包含完整 ID 或当前 UUID 的 8 位前缀。
- [x] 稳定 ID、截止时间“待确认”、55/25/15/5、已完成事实不生成待办等原正式契约全部回归通过。
- [x] `npm test`、`git diff --check`、实际存在的 Git hooks 全部通过，有新鲜命令输出作为证据。
- [x] `git status` 中没有意外文件、敏感信息、缓存、日志或测试产物；已有启动脚本改动未被覆盖或混入。
- [x] 最终汇报包含完成任务、修改文件、逐项测试结果、未完成事项、风险、Git 状态和英文提交记录。

## 四、风险与回退点

- 日期策略只接受明确 ISO 风格日期，宁可保留模型判断也不猜测“本周五”等自然语言，避免时区和语义误判。
- 截止时间纠偏只发生在 AI 提取后；手动任务的 `null/null` 与人工标签语义不变。
- 报告文字的禁止延后校验依赖“完整任务名”约束；若真实模型连续不遵循，将安全失败为 `MODEL_OUTPUT_INVALID`，不得放宽为接受危险建议。
- 新增任务字段均有缺省值，避免旧前端 fixture 或手动任务立即失效；中短期 AI 任务的验收标准是有意加强的服务端语义要求。
- 不通过服务端自动拆分自然语言任务，避免生成用户未确认的待办；过粗任务由模型重试拆分，中长期大里程碑用 `nextAction` 落地。
- `README.md` 的既有未提交修改属于启动脚本工作，本计划明确不编辑该文件；如后续确需同步说明，必须等用户先处理该改动或另行授权独立提交。

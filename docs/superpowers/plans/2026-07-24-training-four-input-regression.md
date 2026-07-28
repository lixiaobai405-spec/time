# Internal Training Four-Input Regression Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一份可直接复制到时间管理助手四个输入框的内部培训场景回归测试文档，并提供 11 项任务的标准时间安排和结果记录区。

**Architecture:** 仅新增一个独立 Markdown 测试文档，不修改应用代码或现有测试资料。文档按“完整四栏输入、标准填写参考、预期现象、结果记录”组织，日期使用相对基准 `D0`，保证不同日期运行时仍可复用。

**Tech Stack:** Markdown、PowerShell 内容校验、Git 单文件提交。

---

### Task 1: 创建完整四栏测试输入

**Files:**
- Create: `tests/time-assistant-training-four-input-regression.md`
- Reference: `docs/superpowers/specs/2026-07-24-training-four-input-regression-design.md`
- Preserve: `.gitignore`
- Preserve: `tests/manual-test-input-template.md`
- Preserve: `frontend/app.js`
- Preserve: `frontend/index.html`
- Preserve: `tests/reference-auth-history.spec.js`
- Preserve: `tests/reference-five-step.spec.js`

- [ ] **Step 1: 创建文档标题和使用说明**

文档开头使用：

```markdown
# 时间管理助手 · 内部培训四栏输入回归测试

> 用途：验证四栏检查、AI 拆解、SMART 校验、时间诊断、优先级报告和每日跟踪自动保存。
>
> 本文全部为虚构测试信息，不包含真实姓名、客户信息、账号、密码、API key、token 或其他敏感信息。
>
> 请将四个代码块分别复制到“昨天、今天、明天、后天”输入框，不要把标题和说明一起复制。
```

- [ ] **Step 2: 写入“昨天”完整输入**

使用目标、结果、差距、原因和改进结构，明确需求调查已经完成，不应再次生成该任务：

```text
目标：昨天18:00前完成内部培训需求调查，覆盖计划参加培训的24名员工，确认他们在工作流程、跨部门协作和工具使用方面最需要解决的问题，并形成培训需求摘要。

结果：已按时收回24份有效问卷，回收率100%。调查归纳出3类高频问题：流程执行标准不一致、跨部门信息确认不及时、常用工具操作不熟练。需求摘要已经发送给培训筹备小组，整体完成度约90%。

差距：原计划同时确认两位内部讲师及授课主题，并完成培训室座位安排，但目前这两项尚未完成。

原因：一位候选讲师临时参加外部会议，会场管理员也未及时确认设备维护时间，导致讲师和场地信息延后。

改进：今天10:30前确认两位内部讲师和各自授课主题；今天11:30前确认培训室、24个座位及安全通道布置。以后在培训开始前至少3个工作日完成讲师和场地确认。
```

- [ ] **Step 3: 写入“今天”完整输入**

正文必须包含 5 项任务，每项都有时间、交付物和验收标准：

```text
1. 今天10:30前确认两位内部讲师及授课主题，把讲师姓名、主题、授课时长和所需设备登记到培训安排表中；验收标准是两位讲师均明确回复确认。

2. 今天11:30前确认培训室和24个座位的布置方案，检查入口、安全通道、电源和讲师操作区；输出一份会场检查清单，所有检查项都要有明确结果。

3. 今天14:00前审核培训提纲，重点检查课程目标、案例顺序、互动环节和测试题范围；输出不少于4条具体修改意见，并标明修改负责人。

4. 今天16:00前完成投影、音响和签到系统测试，分别进行一次实际操作并记录结果；验收标准是三项设备均可正常使用，发现的问题都有处理人和完成时间。

5. 今天17:30前向24名参训人员发送培训通知和课前检查清单，通知中包含培训时间、地点、携带材料和签到要求；验收标准是消息送达率100%，明确回复率达到90%以上。
```

- [ ] **Step 4: 写入“明天”完整输入**

正文按“材料、实施、反馈”顺序写入 3 项任务：

```text
1. 明天10:00前完成培训讲义、2个练习案例和10道测试题的最终定稿，为文件标注统一版本号，并由两位讲师完成复核；验收标准是材料齐全、无待确认批注。

2. 明天14:00至15:30组织90分钟内部培训，完成签到、案例演练和课后测试；计划参训24人，验收标准是实际到场率达到90%以上，课后测试平均分达到80分以上。

3. 明天17:30前收集参训反馈，反馈问卷回收率达到90%以上；汇总满意度、主要问题和改进建议，形成不少于3项改进清单，每项都标明负责人和计划完成日期。
```

- [ ] **Step 5: 写入“后天”完整输入**

正文包含未来 90 天总目标、三个月里程碑和量化验收指标：

```text
未来90天内建立一套可持续的内部培训机制，使培训材料、实施过程和反馈改进都能按统一标准执行，并在3个部门完成推广。

第一个月完成统一的课程提纲模板、讲师清单、签到表、测试题模板和资料归档规范，选择1门课程进行试运行。验收标准是模板全部可用，试运行材料完整归档。

第二个月根据试运行的签到、测试和反馈数据优化课程与反馈流程，确保每场培训都有课程目标、签到记录、课后测试和改进清单，培训资料完整率达到95%以上。

第三个月将培训机制推广到3个部门，每个部门至少完成1场培训，并开展一次月度复盘。最终验收标准：培训到场率达到90%以上，平均满意度达到85分以上，资料归档率达到100%，所有改进事项都有负责人和截止日期。
```

- [ ] **Step 6: 检查四栏正文结构**

运行：

```powershell
$path = 'tests\time-assistant-training-four-input-regression.md'
$content = Get-Content -Raw -Encoding UTF8 $path
[regex]::Matches($content, '```text').Count
```

预期输出：`4`。

### Task 2: 添加标准填写参考和预期结果

**Files:**
- Modify: `tests/time-assistant-training-four-input-regression.md`

- [ ] **Step 1: 添加日期换算说明**

明确运行当天为 `D0`：

```markdown
## 第 2 步标准填写参考

以运行当天为 `D0`：

- 今天：`D0`
- 明天：`D0 + 1 天`
- 第一个月里程碑：`D0 + 30 天`
- 第二个月里程碑：`D0 + 60 天`
- 第三个月里程碑：`D0 + 90 天`
```

- [ ] **Step 2: 添加 11 项标准任务表**

任务表必须覆盖：

1. 今天 10:30，确认两位讲师，0.5 小时，重要且紧急；
2. 今天 11:30，确认会场和座位，0.5 小时，重要且紧急；
3. 今天 14:00，审核培训提纲，1.5 小时，重要且紧急；
4. 今天 16:00，测试设备，0.5 小时，重要且紧急；
5. 今天 17:30，发送通知，0.5 小时，重要且紧急；
6. 明天 10:00，定稿材料，1 小时，重要且紧急；
7. 明天 15:30，完成培训，1.5 小时，重要且紧急；
8. 明天 17:30，汇总反馈，0.5 小时，重要且紧急；
9. `D0 + 30 天` 18:00，完成模板和试运行，6 小时，重要不紧急；
10. `D0 + 60 天` 18:00，优化课程和反馈流程，6 小时，重要不紧急；
11. `D0 + 90 天` 18:00，推广至3个部门并复盘，8 小时，重要不紧急。

- [ ] **Step 3: 添加预期现象**

检查项必须包括：

```markdown
## 预期现象

- [ ] 四栏 AI 检查应倾向于通过。
- [ ] 昨天已经完成的需求调查不应被重复生成待办。
- [ ] AI 应倾向于拆解出约 11 项任务。
- [ ] SMART 校验应倾向于全部通过。
- [ ] 优先级排序应先处理今天有明确截止时间的任务。
- [ ] 优化报告接口应返回 200，不应出现 Nginx 504。
- [ ] 进入每日跟踪后，应自动保存运行当天生成的全部任务。
```

- [ ] **Step 4: 添加结果记录表**

```markdown
## 测试结果记录

| 项目 | 实际结果 |
|---|---|
| 测试日期 | |
| 四栏检查 | |
| AI 拆解任务数 | |
| SMART 校验 | |
| 时间分布诊断 | |
| 优先级排序 | |
| 报告接口状态码 | |
| 报告接口耗时 | |
| 每日跟踪自动保存 | |
| 浏览器控制台异常 | |
| 失败 requestId | |
```

### Task 3: 验证并提交新测试文档

**Files:**
- Test: `tests/time-assistant-training-four-input-regression.md`
- Preserve all unrelated modified and untracked files.

- [ ] **Step 1: 检查文档不存在占位语和敏感信息**

运行：

```powershell
$path = 'tests\time-assistant-training-four-input-regression.md'
Select-String -Path $path -Pattern 'T[B]D|T[O]DO|X[X]X|sk-[A-Za-z0-9]|password\s*=|token\s*=' -Encoding UTF8
```

预期输出：无匹配。

- [ ] **Step 2: 检查任务表数量和关键指标**

运行：

```powershell
$path = 'tests\time-assistant-training-four-input-regression.md'
$content = Get-Content -Raw -Encoding UTF8 $path
'TaskRows=' + ([regex]::Matches($content, '(?m)^\|\s*\d+\s*\|').Count)
'Has24Participants=' + $content.Contains('24名')
'Has90Days=' + $content.Contains('未来90天')
'HasFourInputs=' + ([regex]::Matches($content, '```text').Count -eq 4)
```

预期输出：

```text
TaskRows=11
Has24Participants=True
Has90Days=True
HasFourInputs=True
```

- [ ] **Step 3: 检查 Markdown 和 Git 范围**

运行：

```powershell
git diff --check -- 'tests/time-assistant-training-four-input-regression.md'
git status --short
```

预期：新文档没有空白错误；现有用户改动保持未暂存。

- [ ] **Step 4: 仅暂存新测试文档**

```powershell
git add -- 'tests/time-assistant-training-four-input-regression.md'
git diff --cached --name-status
```

预期仅显示：

```text
A	tests/time-assistant-training-four-input-regression.md
```

- [ ] **Step 5: 提交**

```powershell
git commit -m "test: add training four-input regression"
```

预期：提交仅包含新测试文档，现有 `.gitignore`、前端文件、参考测试和手工模板均不进入提交。

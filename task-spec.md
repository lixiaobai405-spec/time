# Task Spec

## 1. Task Title

将第二步恢复为模型直接返回 `tasks`，移除证据包与二次事实复核链路。

## 2. Goal

把五步流程的第二步“AI 拆解确认”恢复为此前已经能够成功运行的直接任务输出模式：

- 模型一次返回顶层仅含 `tasks` 的 JSON；
- 正常合法输出只发生一次模型调用；
- 仅当 JSON 格式或基础任务语义非法时，服务端最多自动重试一次；
- 不再要求模型生成 `claims`、`candidateTasks`、字符区间、精确原文切片或证据关系；
- 不再调用步骤 2A 的可疑事实复核模型；
- `/api/time-management/tasks/decompose` 恢复为 `intake + tasks + smart` 的响应；
- 保留当前已经实现的日期级 `due`、责任人 `owner`、SMART 校验、截止日期紧急度修正和其他四个流程节点。

目标是缩短第二步模型上下文和输出长度，消除正常请求可能连续调用两个模型所带来的长耗时，同时避免通过整文件回退破坏当前工作区的其他成果。

## 3. Project Context

### 已确认的当前事实

- 当前分支为 `main`，`HEAD` 为：

  ```text
  60efdcc feat: hide task deadlines and improve intake guidance
  ```

- 当前工作区存在大量未提交修改，涉及截止日期、责任人、每日跟踪、历史时间分布、报告生成诊断等多项成果。
- `HEAD` 中的第二步原实现由模型直接返回：

  ```js
  {
    tasks: [
      {
        name,
        importance,
        urgency,
        source,
        due?,
        est,
        acceptanceCriteria?,
        nextAction?,
        status
      }
    ]
  }
  ```

- `HEAD` 中合法输出的正常路径调用模型一次；只有 `MODEL_OUTPUT_INVALID` 才由工作流执行第二次调用。
- 当前未提交版本把第二步改成：

  ```js
  {
    claims: [...],
    candidateTasks: [...]
  }
  ```

- 当前版本要求模型返回 UTF-16 字符索引、`quote`、`dispositionEvidence`、`actionEvidence`、`ownerRelation` 和 `dueEvidence`，再由服务端投影为任务。
- 当前版本在结构或语义修复之外，还可能调用 `review-task-claims` 进行步骤 2A 定向复核，因此一次第二步请求可能串行调用模型两次。
- 当前证据链专属实现为：
  - `server/contracts/task-extraction-evidence.js`
  - `server/workflows/task-evidence-validator.js`
  - `server/workflows/review-ambiguous-claims.js`
- 当前证据链专属测试为：
  - `tests/server/task-extraction-evidence.test.js`
  - `tests/server/task-evidence-validator.test.js`
  - `tests/server/review-ambiguous-claims.test.js`
- 当前前端通过 `state.taskWarnings` 和 `.task-warning-list` 显示证据链产生的“完成状态不明确”警告。
- 当前 `/tasks/decompose` 响应额外包含 `warnings` 和 `analysisVersion: 'evidence-v1'`。
- 当前 `server/contracts/time-management.js` 已增加并统一标准化：
  - `due`：新写入为 `YYYY-MM-DD` 或“待确认”；
  - `owner`：空值、缺失和空白统一为“待确认”。
- 当前真实 API 单次受控诊断中：
  - 第一步 `/intake/check` 返回 `200`；
  - 第二步 `/tasks/decompose` 在客户端等待 175 秒后仍未返回；
  - 服务仍可响应健康检查；
  - 因第二步未结束，没有继续执行第三至第五步。
- 当前假模型定向回归：

  ```powershell
  .\.conda\node.exe --test tests/server/extract-tasks.test.js tests/server/review-ambiguous-claims.test.js tests/server/task-evidence-validator.test.js tests/server/five-step-api.test.js
  ```

  结果为 113 项通过、0 项失败。这说明证据链在合规假模型输出下可运行，但不能证明真实模型链路的时延和稳定性满足要求。
- `D:\codex-pj\time\docs\测试文档.md` 的关键回归语义为：
  - “昨天已经完成复盘报告”不得重复生成待办；
  - “确认剩余 2 项负责人”应成为今天任务。

### 用户明确要求

- 把第二步改回模型直接返回 `tasks`。
- 恢复到此前能够成功完成流程的状态。
- 当前只生成修改计划，不实施代码。

### Planner 决策

- 采用“选择性回退”，不使用 `git checkout`、`git restore` 或整文件覆盖恢复 `HEAD`。
- 直接任务契约以 `HEAD` 的稳定结构为基础，但保留当前新增的 `owner` 和日期级 `due`。
- 模型输出顶层必须且只能包含 `tasks`。
- 任务对象允许模型直接返回以下公开业务字段：

  ```js
  {
    name,
    importance,
    urgency,
    source,
    due,
    est,
    owner,
    acceptanceCriteria,
    nextAction,
    status
  }
  ```

- `id` 和 `classificationSource` 继续由服务端生成，不要求模型返回。
- 为降低偶发格式失败，`due`、`owner`、`acceptanceCriteria` 和 `nextAction` 在 Ajv 模型响应 Schema 中保持可选；标准化后分别得到“待确认”、空数组或空字符串。
- 模型提示词仍要求主动返回 `due` 和 `owner`；缺少原文明示信息时必须填“待确认”。
- 服务端保留轻量确定性校验：
  - 任务名称和工时非空；
  - 来源对应的输入栏非空；
  - 重要性、紧急度、来源和状态枚举合法；
  - 短期和中长期任务包含验收标准；
  - 超过 8 小时的中长期任务包含 `nextAction`；
  - 具体责任人至少必须原样出现在对应输入栏，否则本次输出视为非法；
  - 纯“昨天已完成事实且没有其他输入或后续行动”的结果不得生成任务。
- 不恢复精确字符区间、原子 claim、owner 责任关系证明或 due 证据切片校验。
- 对“昨天”的保守口径改为 Prompt + 轻量服务端门禁：
  - 明确已完成的事实不生成任务；
  - 只有明确未完成、延期、待处理或后续行动才生成复盘任务；
  - 完成状态不明确时不返回前端 warning，模型应保守地不生成该项。
- 旧的历史时间分布计划从根 `task-spec.md` 暂时让位给本计划；其当前代码成果不得被本任务撤销。

### 尚未验证的信息

- 真实供应商在直接 `tasks` 提示词下的当前耗时和成功率尚未重新验证。
- 生产服务器是否包含当前本地未提交修改尚未验证。
- 本计划不读取 `.env`、不连接生产服务器、不执行真实付费模型请求。

## 4. Scope

### 后端任务提取

- 将 `server/workflows/extract-tasks.js` 改回直接任务输出工作流：
  - 在文件内恢复直接 `tasks` Ajv Schema；
  - Schema 顶层 `additionalProperties: false`，只允许 `tasks`；
  - 每条任务只允许公开任务字段，不允许 `claims`、证据字段或内部诊断字段；
  - 保留当前 `owner` 字段及 `TEXT_LIMITS.owner`；
  - 保留 `normalizeTask()`；
  - 保留 `applyDeadlineUrgency()`；
  - 保留 `normalizeDueForWrite()`，确保最终新任务只写日期级 `due`；
  - 保留当前 `临时 -> 今天` 的来源映射；
  - 恢复“正常一次、非法最多重试一次”的简单循环；
  - 每次调用继续给模型客户端传 `maxAttempts: 1`，避免模型客户端和工作流形成嵌套重试；
  - 合法结果返回 `{ tasks }`；
  - `MODEL_TIMEOUT`、`MODEL_UPSTREAM_ERROR` 和 `MODEL_OUTPUT_INVALID` 的公开错误映射保持不变。
- 不把 `retryFeedback` 或证据诊断码继续发给模型。
- `MODEL_TIMEOUT` 和 `MODEL_UPSTREAM_ERROR` 不做工作流级自动重试；仅 `MODEL_OUTPUT_INVALID` 允许第二次调用。

### 第二步编排与 API

- 修改 `server/workflows/decompose-tasks.js`：
  - `extractTasks()` 返回零任务时恢复为 `422 NO_ACTIONABLE_TASKS`；
  - 不再以 warning 允许零任务继续；
  - 非空任务始终执行初始 `checkTaskSmart()`；
  - 返回结构恢复为：

    ```js
    {
      intake: {
        lineCounts,
        totalLines,
        warnings
      },
      tasks,
      smart
    }
    ```

  - 这里的 `intake.warnings` 是第一步输入校验信息，必须保留；
  - 删除的只是第二步证据链专属顶层 `warnings` 和 `analysisVersion`。
- 保持现有路由路径、认证、CSRF（跨站请求伪造防护）、请求体和公开错误格式不变。

### Prompt

- 在 `prompts/system.md` 只重写“步骤 2 · 任务提取”：
  - 恢复直接任务拆解角色；
  - 顶层只返回 `tasks`；
  - 删除 claims、candidateTasks、UTF-16 区间、quote 和 evidence 规则；
  - 保留当前重要性、紧急度、8 小时拆分、验收标准和下一步规则；
  - 保留日期只到日级的最终业务要求，但允许模型输出原文明示期限文本，由服务端解析和标准化；
  - 增加 `owner`：只能提取原文明确责任主体，不得把接收人、评审人或参与人推断为责任人；不明确时返回“待确认”；
  - 保留“昨天只拆未完成、延期、待处理和后续行动；已完成事实不得生成待办”；
  - 明确完成状态不清时保守跳过，不产生 warning 协议；
  - 输出示例只包含 `tasks`。
- 删除完整的“步骤 2A · 可疑事实定向复核”段落。
- 在 `server/prompts/load-step-prompt.js` 删除 `review-task-claims` heading 映射。
- 步骤 1、3、4、5 的 Prompt 内容不得改动。

### 证据链清理

- 在所有引用移除并用 `rg` 复核后，删除以下证据链专属文件：
  - `server/contracts/task-extraction-evidence.js`
  - `server/workflows/task-evidence-validator.js`
  - `server/workflows/review-ambiguous-claims.js`
  - `tests/server/task-extraction-evidence.test.js`
  - `tests/server/task-evidence-validator.test.js`
  - `tests/server/review-ambiguous-claims.test.js`
- 删除前必须确认这些文件仅服务第二步证据链，没有被其他节点或公共契约复用。
- 不删除 `tests/manual-test-input-template.md`；它是通用人工业务回归资料，不属于证据链运行依赖。

### 前端

- 修改 `frontend/app.js`：
  - 删除 `taskWarningList()`；
  - 删除第二步任务页中的 warning 区块；
  - `decomposeTasks()` 不再清空或写入 `state.taskWarnings`；
  - 继续使用 `result.tasks` 和 `result.smart`；
  - 保留第一步 `state.intake.warnings` 的显示逻辑；
  - 不改变任务编辑、日期、责任人、SMART、第三步、矩阵、报告、历史和每日跟踪功能。
- 修改 `frontend/state.js`：
  - 删除 `taskWarnings` 初始状态；
  - 删除失效和重置函数中的 `taskWarnings` 清理。
- 修改 `frontend/index.html`：
  - 删除只供 `.task-warning-list` 和 `.task-warning` 使用的样式；
  - 不调整其他页面视觉。

### 测试与文档

- 将第二步相关假模型 fixture 从证据包恢复为 `{ tasks: [...] }`。
- 重构 `tests/server/extract-tasks.test.js`，保留直接任务路径仍适用的业务测试，删除依赖字符区间和 claim 投影的测试。
- 更新：
  - `tests/server/five-step-api.test.js`
  - `tests/server/workflow-auth.test.js`
  - `tests/server/prompt-contract.test.js`
  - `tests/reference-five-step.spec.js`
- `tests/server/extract-tasks.test.js` 必须覆盖：
  - 模型直接返回任务；
  - 合法输出恰好一次模型调用；
  - 首次格式非法时第二次成功；
  - 连续两次格式非法时安全失败；
  - 超时和上游错误不做第二次工作流调用；
  - `due` 日期级标准化；
  - `owner` 明示提取和缺失回退；
  - 虚构 owner 被拒绝；
  - 昨天纯完成事实不生成任务；
  - 昨天已完成事实和明确后续行动混合时只保留后续行动；
  - 今天、明天、后天任务仍可正常生成；
  - 零任务返回 `NO_ACTIONABLE_TASKS`。
- 用 `D:\codex-pj\time\docs\测试文档.md` 的虚构四栏文本增加或保留假模型业务回归：
  - 已完成复盘报告不进入任务；
  - 确认剩余 2 项负责人进入任务；
  - 任务对象包含 `due` 和 `owner`；
  - 测试不调用真实模型。
- 更新 `README.md`：
  - 第二步说明改为模型直接返回任务；
  - API 响应删除顶层 `warnings` 和 `analysisVersion`；
  - 保留 `owner`、日期级 `due`、历史时间分布、每日跟踪和报告诊断等当前说明；
  - 不声称真实模型已经重新验证成功。

## 5. Non-Scope

- 不恢复或覆盖 `HEAD` 中已经过时的整个文件版本。
- 不撤销当前日期级 `due` 和责任人 `owner` 功能。
- 不撤销工作台每日事项、每日跟踪持久化或相关前端编辑。
- 不撤销历史详情中的第三步时间分布快照、migration 004 或 Schema 2 兼容工作。
- 不修改第三步时间分布算法、第四步矩阵或第五步报告业务逻辑。
- 不撤销 `server/model/model-client.js` 中通用的模型响应完成原因和安全诊断能力。
- 不撤销 `server/model/parse-model-json.js`、`server/workflows/report-output-diagnostics.js`、`server/policies/report-schedule.js` 或报告生成的现有修复。
- 不新增数据库 migration。
- 不新增、升级或删除 npm 依赖。
- 不引入前端构建工具。
- 不修改认证、Session、CSRF、账号隔离或部署配置。
- 不读取 `.env` 或任何真实 API key。
- 不调用真实付费模型；如后续需要真实 API 验证，必须由用户另行明确授权一次调用范围。
- 不连接生产服务器，不执行部署、数据库迁移或数据修复。
- 不处理 `tmp/` 或其他无关未跟踪文件。
- 不 commit、不 push、不创建 PR。

## 6. Constraints

- 全程在 `D:\codex-pj\time` 使用 PowerShell 7。
- 项目测试必须使用 `.conda` 中的 Node `v20.20.2` 和 npm `10.8.2`。
- 不得使用全局 Node 24。
- 每批修改前先检查相关文件当前 diff；以当前工作区为基线做最小编辑。
- 禁止：
  - `git checkout -- <file>`
  - `git restore <file>`
  - `git reset --hard`
  - 整文件替换为 `HEAD`
  - 运行会格式化整个仓库的命令
- 证据链改动与其他未提交功能混在同一文件时，只删除证据链对应的行和测试断言。
- 删除 untracked 证据链文件前，先用 `rg` 确认没有剩余 import 或调用。
- 不输出或记录模型原文、Prompt 请求正文、凭据、Cookie 或用户敏感信息。
- 自动化测试只能使用假模型、临时数据库和占位凭据。
- 若 4174 端口被占用，不得擅自终止未知进程。
- 任何未执行的测试必须标记为“未验证”，不得声称通过。

## 7. Related Files

### 必须修改

- `prompts/system.md`
- `server/prompts/load-step-prompt.js`
- `server/workflows/extract-tasks.js`
- `server/workflows/decompose-tasks.js`
- `frontend/app.js`
- `frontend/state.js`
- `frontend/index.html`
- `tests/server/extract-tasks.test.js`
- `tests/server/five-step-api.test.js`
- `tests/server/workflow-auth.test.js`
- `tests/server/prompt-contract.test.js`
- `tests/reference-five-step.spec.js`
- `README.md`

### 计划删除的证据链专属文件

- `server/contracts/task-extraction-evidence.js`
- `server/workflows/task-evidence-validator.js`
- `server/workflows/review-ambiguous-claims.js`
- `tests/server/task-extraction-evidence.test.js`
- `tests/server/task-evidence-validator.test.js`
- `tests/server/review-ambiguous-claims.test.js`

### 只读复核、原则上不得修改

- `server/contracts/time-management.js`
- `server/policies/deadline.js`
- `server/workflows/check-task-smart.js`
- `server/app.js`
- `server/model/model-client.js`
- `server/model/parse-model-json.js`
- `server/workflows/diagnose-distribution.js`
- `server/workflows/classify-matrix.js`
- `server/workflows/generate-report.js`
- `server/workflows/report-output-diagnostics.js`
- `server/history/contracts.js`
- `server/repositories/history-repository.js`
- `server/database/migrations.js`
- `server/database/migrations/004-history-distribution.js`
- `server/daily-tracking/*`
- `tests/server/contracts.test.js`
- `tests/server/model-client.test.js`
- `tests/server/generate-report.test.js`
- `tests/server/history-*.test.js`
- `tests/server/daily-tracking-*.test.js`
- `D:\codex-pj\time\docs\测试文档.md`
- `tests/manual-test-input-template.md`

如果实现过程中发现必须修改“只读复核”文件，executor 必须先说明具体阻塞和最小改动理由，不能自行扩大范围。

## 8. Implementation Steps

### 阶段一：保护工作区并建立基线

1. 执行：

   ```powershell
   git status --short --branch
   git log -5 --oneline --decorate
   git diff --stat
   git diff -- prompts/system.md server/prompts/load-step-prompt.js server/workflows/extract-tasks.js server/workflows/decompose-tasks.js frontend/app.js frontend/state.js frontend/index.html README.md
   ```

2. 记录任务开始前所有相关文件的未提交差异，特别标记：
   - `owner`；
   - 日期级 `due`；
   - 历史第三步快照；
   - 每日跟踪；
   - 报告生成诊断。

3. 确认项目运行时：

   ```powershell
   $projectNodeDir = (Resolve-Path '.\.conda').Path
   $env:PATH = "$projectNodeDir;$env:PATH"
   node --version
   npm.cmd --version
   ```

4. 版本不是 Node `v20.20.2`、npm `10.8.2` 时停止并报告。

5. 运行当前第二步假模型基线：

   ```powershell
   node --test tests/server/extract-tasks.test.js tests/server/five-step-api.test.js tests/server/prompt-contract.test.js tests/server/workflow-auth.test.js
   ```

   记录退出码、通过数和失败数。该结果只作为当前证据链基线，不代表直接任务模式已通过。

### 阶段二：先写直接任务契约的失败测试

6. 在 `tests/server/extract-tasks.test.js` 先将最小 happy path fixture 改为：

   ```js
   {
     tasks: [{
       name: '确认剩余2项改进措施的负责人',
       importance: '高',
       urgency: '高',
       source: '今天',
       due: '今天11:30前',
       est: '30分钟',
       owner: '待确认',
       acceptanceCriteria: ['2项措施均登记责任人'],
       nextAction: '',
       status: 'pending'
     }]
   }
   ```

7. 增加或调整断言：
   - `completeJson()` 收到的用户 JSON 只有 `goals`；
   - 合法输出时 `completeJson()` 调用次数严格为 1；
   - 返回对象只有 `tasks`；
   - 返回任务没有 claim 或 evidence 字段；
   - `owner`、`due`、`classificationSource` 均正确标准化。

8. 增加模型调用次数边界测试：
   - 首次 `{ claims: [], candidateTasks: [] }`、第二次合法 `{ tasks }`：调用 2 次并成功；
   - 两次均非法：调用 2 次并返回 `MODEL_OUTPUT_INVALID`；
   - 首次 `MODEL_TIMEOUT`：调用 1 次并返回 504；
   - 首次 `MODEL_UPSTREAM_ERROR`：调用 1 次并返回 502。

9. 在 `tests/server/five-step-api.test.js` 写入失败断言：
   - `/tasks/decompose` 接受直接 `{ tasks }` 假模型响应；
   - 响应键为 `intake`、`tasks`、`smart`；
   - 顶层不存在 `warnings` 和 `analysisVersion`；
   - 零任务返回 `422 NO_ACTIONABLE_TASKS`。

10. 在 `tests/server/prompt-contract.test.js` 写入失败断言：
    - 步骤 2 只要求顶层 `tasks`；
    - 提示词没有 `claims`、`candidateTasks`、`UTF-16`、`ownerRelation`、`dueEvidence` 或 `retryFeedback`；
    - `loadStepPrompt('review-task-claims')` 返回 `PROMPT_INVALID`；
    - 提示词仍明确 owner 不能推断、已完成事实不能生成待办。

11. 运行 Red：

    ```powershell
    node --test tests/server/extract-tasks.test.js tests/server/five-step-api.test.js tests/server/prompt-contract.test.js
    ```

    预期退出码非 `0`，失败必须明确来自当前代码仍要求证据包或仍返回 `analysisVersion`，不得接受语法错误、fixture 错误或无关功能失败作为 Red。

### 阶段三：恢复后端直接任务路径

12. 在 `server/workflows/extract-tasks.js` 移除：
    - `inspectEvidenceEnvelope`；
    - `projectEvidenceTasks`；
    - `reviewAmbiguousClaims`；
    - `callsUsed`；
    - `callMainModel()`；
    - `repairStructure()`；
    - `retryFeedback`；
    - `analysisVersion`；
    - 证据 warning 投影。

13. 在同一文件恢复直接 `tasks` Ajv Schema，并纳入当前字段：

    ```js
    {
      type: 'object',
      additionalProperties: false,
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          maxItems: TASK_LIMIT,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'name',
              'importance',
              'urgency',
              'source',
              'est',
              'status'
            ],
            properties: {
              name,
              importance,
              urgency,
              source,
              due,
              est,
              owner,
              acceptanceCriteria,
              nextAction,
              status
            }
          }
        }
      }
    }
    ```

14. 保持 `due` 和 `owner` 可选，以便兼容缺失字段的模型输出；随后由 `normalizeTask()` 补为“待确认”。

15. 增加轻量 owner 校验：
    - `owner === '待确认'` 或空缺时允许；
    - 具体 owner 必须原样出现在 `SOURCE_GOAL_KEY[task.source]` 对应的输入文本；
    - owner 不在输入文本时判为 `MODEL_OUTPUT_INVALID` 并进入唯一一次重试；
    - 不重建责任关系字符区间或接收人/参与人语法解析器。

16. 恢复简单循环：

    ```js
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // 单次 modelClient.completeJson(request)
      // validateResponse
      // assertTaskSemantics
      // normalizeTask
      // applyDeadlineUrgency
      // normalizeDueForWrite
      // return { tasks }
    }
    ```

17. 保证 `request.maxAttempts = 1`；工作流只对 `MODEL_OUTPUT_INVALID` 执行第二次调用。

18. 修改 `server/workflows/decompose-tasks.js`，恢复非空任务门禁和 `intake + tasks + smart` 返回结构。

19. 运行 Green：

    ```powershell
    node --test tests/server/extract-tasks.test.js tests/server/five-step-api.test.js
    ```

    预期退出码 `0`。

### 阶段四：恢复直接任务 Prompt

20. 仅编辑 `prompts/system.md` 的步骤 2 和步骤 2A：
    - 用直接任务规则替换步骤 2 证据规则；
    - 输出示例顶层只含 `tasks`；
    - 输出任务示例含 `owner`；
    - 删除步骤 2A 整段；
    - 不触碰步骤 1、3、4、5。

21. 从 `server/prompts/load-step-prompt.js` 删除 `review-task-claims`。

22. 运行 Prompt Green：

    ```powershell
    node --test tests/server/prompt-contract.test.js
    ```

    预期退出码 `0`。

### 阶段五：清理证据链运行代码

23. 先执行：

    ```powershell
    rg -n "task-extraction-evidence|task-evidence-validator|review-ambiguous-claims|review-task-claims" server tests prompts
    ```

24. 在确认剩余命中仅位于待删除文件后，删除六个证据链专属实现和测试文件。

25. 再执行：

    ```powershell
    rg -n "task-extraction-evidence|task-evidence-validator|review-ambiguous-claims|review-task-claims|claims|candidateTasks|evidence-v1" server tests prompts
    ```

    对运行代码和有效测试预期无命中。若 `claims` 作为无关英语文本出现在其他模块，人工确认后记录，不做无关删除。

### 阶段六：清理前端证据 warning

26. 在 `frontend/app.js`、`frontend/state.js` 和 `frontend/index.html` 只删除第二步证据 warning 状态、渲染和样式。

27. 保留以下内容：
    - `state.intake.warnings`；
    - 第一页四栏输入 warning；
    - 通用 toast 和错误处理；
    - `due`、`owner` 编辑；
    - 当前历史、每日跟踪和工作台功能。

28. 更新 `tests/reference-five-step.spec.js`：
    - mock `/tasks/decompose` 返回 `intake + tasks + smart`；
    - 删除 `.task-warning-list` 和 `analysisVersion` 断言；
    - 保留任务直接展示、编辑和继续第三步的回归。

29. 运行定向 E2E：

    ```powershell
    $env:PLAYWRIGHT_BROWSERS_PATH = '0'
    npm.cmd run test:e2e -- --grep "五步|任务拆解|AI 拆解"
    ```

    若正则未匹配任何测试，不得以退出码 `0` 声称通过；应改用实际测试标题精确执行。

### 阶段七：业务回归、文档和交付

30. 用 `D:\codex-pj\time\docs\测试文档.md` 的四栏文本建立假模型回归，确认：
    - 模型 fixture 只返回 `{ tasks }`；
    - “复盘报告已经完成并发送给团队”不生成任务；
    - “确认剩余2项改进措施的负责人”生成今天任务；
    - 最终任务携带日期级 `due` 和 `owner`；
    - 不包含证据字段。

31. 更新 `tests/server/workflow-auth.test.js`，确认认证和 CSRF 边界下直接任务响应仍工作。

32. 更新 `README.md`，只撤销证据链及第二步额外响应字段的说明，保留所有其他当前能力说明。

33. 运行定向服务端组合测试：

    ```powershell
    node --test tests/server/contracts.test.js tests/server/extract-tasks.test.js tests/server/five-step-api.test.js tests/server/prompt-contract.test.js tests/server/workflow-auth.test.js
    ```

34. 运行完整服务端和 E2E：

    ```powershell
    npm.cmd run test:server
    $env:PLAYWRIGHT_BROWSERS_PATH = '0'
    npm.cmd run test:e2e
    ```

35. 运行项目总测试：

    ```powershell
    $env:PLAYWRIGHT_BROWSERS_PATH = '0'
    npm.cmd test
    ```

36. 最终静态复核：

    ```powershell
    rg -n "taskWarnings|task-warning|analysisVersion|evidence-v1|review-task-claims|candidateTasks|ownerRelation|dueEvidence" frontend server tests prompts README.md
    git diff --check
    git status --short --branch
    git diff --stat
    git diff
    ```

37. 人工核对最终 diff：
    - `owner` 和日期级 `due` 仍存在；
    - 历史第三步快照和 migration 004 仍存在；
    - 每日跟踪及工作台改动仍存在；
    - 报告生成诊断仍存在；
    - 只有证据链相关代码被选择性撤销；
    - 没有 `.env`、数据库、日志、真实模型内容或无关文件进入改动；
    - 没有 commit 或 push。

38. executor 最终报告：
    - 修改与删除文件清单；
    - 直接任务响应结构；
    - 正常路径和异常路径的模型调用次数；
    - Red/Green 证据；
    - 定向和完整测试结果；
    - 未验证事项；
    - Git 状态摘要；
    - 明确真实 API 未执行，等待用户决定是否另行授权一次复测。

## 9. Risks and Notes

- **最大风险是误回退其他成果。** `extract-tasks.js`、`prompts/system.md`、前端和测试均混有未提交功能，绝不能用 `HEAD` 整体覆盖。
- **`HEAD` 没有当前 owner 完整实现。** 直接复制旧文件会丢失责任人字段，因此必须重建直接 Schema 并显式保留 `owner`。
- **直接任务模式降低了证据强度。** 移除精确字符区间后，服务端无法严格证明 owner 与动作属于同一原子事实；本计划用 Prompt 约束和“owner 必须出现在对应栏”作保守下限。
- **已完成事实识别回归为模型主导。** 服务端仍保留纯昨天已完成场景门禁，但混合长文本中的完成/未完成拆分主要依赖 Prompt。必须用甲方测试文档做假模型业务回归，真实模型质量另行验证。
- **正常一次不等于永远一次。** 合法直接输出严格一次；格式或基础语义非法仍允许一次自动重试，所以异常路径最多两次。
- **嵌套重试风险。** `modelClient.completeJson()` 必须继续使用 `maxAttempts: 1`，否则工作流两次循环可能放大为更多上游请求。
- **顶层 warnings 容易与 intake warnings 混淆。** 只删除第二步证据 warning；第一步 `intake.warnings` 必须保留。
- **删除 untracked 文件不可由 Git 恢复。** 六个证据链文件虽为 untracked，删除前必须确认只属于本次证据方案；需要回看时可从当前 diff/任务记录重建，但不得误删其他 untracked 内容。
- **API 兼容变化。** 前端和测试必须同步停止读取 `warnings`、`analysisVersion`；外部调用方若依赖这两个临时字段，需要同步调整。
- **模型 JSON 仍可能偶发非法。** 本次目标是缩短和简化协议，不承诺消除供应商随机性。完成后应先看假模型门禁，再由用户决定是否进行一次真实 API 回归。
- **真实 API 成本与隐私。** 本计划验证不调用真实模型；后续真实测试必须重新取得明确授权，并只使用虚构测试文档。
- **历史计划延期。** 根 `task-spec.md` 被本回退计划替换，不代表当前已经实现的历史时间分布改动应被撤销。

## 10. Acceptance Criteria

- [ ] 第二步模型请求的 system Prompt 只要求直接返回顶层 `tasks`。
- [ ] 模型合法响应结构为 `{ tasks: [...] }`，不存在 `claims` 或 `candidateTasks`。
- [ ] 每个任务只包含公开任务字段；没有 claimId、字符区间、quote 或 evidence 字段。
- [ ] 合法输出时模型调用次数严格为 1。
- [ ] 首次 `MODEL_OUTPUT_INVALID` 时最多再调用 1 次，总调用次数不超过 2。
- [ ] `MODEL_TIMEOUT` 和 `MODEL_UPSTREAM_ERROR` 不触发工作流第二次调用。
- [ ] 模型客户端每次请求使用 `maxAttempts: 1`，不存在嵌套重试放大。
- [ ] `extractTasks()` 返回对象只有 `tasks`。
- [ ] `/tasks/decompose` 返回 `intake`、`tasks` 和 `smart`，不返回顶层 `warnings` 或 `analysisVersion`。
- [ ] 第一阶段的 `intake.warnings` 保持可用。
- [ ] 零任务返回 `422 NO_ACTIONABLE_TASKS`，不能以空任务进入第三步。
- [ ] `review-task-claims` Prompt 和加载映射已移除。
- [ ] 三个证据链运行文件及三个专属测试文件已删除。
- [ ] 运行代码中不存在 `evidence-v1`、`candidateTasks`、`ownerRelation` 或 `dueEvidence`。
- [ ] 前端不存在 `state.taskWarnings`、`.task-warning-list` 或相关样式。
- [ ] `due` 仍为日期级 `YYYY-MM-DD` 或“待确认”。
- [ ] `owner` 仍存在；缺失或空白标准化为“待确认”。
- [ ] 模型返回具体 owner 时，该文本必须出现在对应输入栏；虚构 owner 会触发格式异常重试或最终失败。
- [ ] `id` 和 `classificationSource: 'ai-extraction'` 仍由服务端生成。
- [ ] 截止日期紧急度修正仍执行。
- [ ] 短期和中长期验收标准、超过 8 小时里程碑的 `nextAction` 规则仍执行。
- [ ] 纯“昨天已完成”文本不会生成任务。
- [ ] “昨天已完成 + 明确后续行动”只生成后续行动。
- [ ] `docs/测试文档.md` 回归中已完成复盘不重复生成，确认剩余 2 项负责人正常生成。
- [ ] 第二步任务可以继续通过 SMART，并进入第三、四、五步的假模型 E2E。
- [ ] 历史时间分布、每日跟踪、工作台、报告诊断和 owner/due 现有改动未被覆盖或撤销。
- [ ] 无数据库 migration、依赖、认证、部署或生产数据变更。
- [ ] 不读取 `.env`，不调用真实付费模型。
- [ ] 所有定向测试、完整服务端测试、完整 E2E 和 `npm.cmd test` 通过。
- [ ] `git diff --check` 退出码为 `0`。
- [ ] executor 未自行 commit 或 push。

## 11. Verification

所有命令均在 PowerShell 7 和 `D:\codex-pj\time` 中执行。

### 1. Node 版本门禁

```powershell
$projectNodeDir = (Resolve-Path '.\.conda').Path
$env:PATH = "$projectNodeDir;$env:PATH"
node --version
npm.cmd --version
```

预期：

- 两条命令退出码均为 `0`；
- Node 为 `v20.20.2`；
- npm 为 `10.8.2`。

版本不符时停止，不得使用全局 Node。

### 2. 第二步 TDD Red

```powershell
node --test tests/server/extract-tasks.test.js tests/server/five-step-api.test.js tests/server/prompt-contract.test.js
```

预期实现前退出码非 `0`，失败明确显示当前实现仍期待 evidence envelope、额外响应字段或步骤 2A。

### 3. 第二步核心 Green

```powershell
node --test tests/server/extract-tasks.test.js tests/server/five-step-api.test.js
```

预期退出码 `0`；合法一次调用、非法最多两次、超时不重试、直接响应、owner/due 和零任务门禁均通过。

### 4. Prompt Green

```powershell
node --test tests/server/prompt-contract.test.js
```

预期退出码 `0`；直接 `tasks` Prompt、owner 约束、已完成事实规则和步骤 2A 移除全部通过。

### 5. 认证与接口组合回归

```powershell
node --test tests/server/workflow-auth.test.js tests/server/contracts.test.js tests/server/five-step-api.test.js
```

预期退出码 `0`；认证、CSRF、任务公共结构和五步 API 无失败。

### 6. 证据链残留检查

```powershell
rg -n "task-extraction-evidence|task-evidence-validator|review-ambiguous-claims|review-task-claims|candidateTasks|ownerRelation|dueEvidence|analysisVersion|evidence-v1" frontend server tests prompts README.md
```

预期无命中。若命中无关说明文字，必须人工分类并在交付中记录；运行代码不得残留。

### 7. 前端定向 E2E

```powershell
Get-NetTCPConnection -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npm.cmd run test:e2e -- --grep "五步|任务拆解|AI 拆解"
```

预期：

- 端口空闲，或已明确识别为测试允许使用的项目进程；
- 不终止未知进程；
- Playwright 退出码 `0`；
- 确实命中第二步和五步流程测试；
- 页面没有 task warning 区块；
- 任务仍显示并可编辑日期与责任人；
- 流程可以继续到后续节点。

### 8. 完整服务端测试

```powershell
npm.cmd run test:server
```

预期退出码 `0`；失败数为 `0`，无取消或未预期跳过。

### 9. 完整 E2E

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npm.cmd run test:e2e
```

预期退出码 `0`；五步、历史、每日跟踪、工作台、认证和窄屏回归全部通过。

### 10. 项目总测试

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npm.cmd test
```

预期退出码 `0`。

### 11. 最终差异检查

```powershell
git diff --check
git status --short --branch
git diff --stat
git diff
```

预期：

- `git diff --check` 退出码 `0`；
- Git 命令均退出码 `0`；
- 差异只包含任务开始前已有修改和本计划要求的选择性回退；
- `owner`、日期级 `due`、历史第三步快照、每日跟踪、工作台及报告修复仍存在；
- 没有 `.env`、API key、数据库文件、模型原文、日志、缓存或无关文件；
- 没有 commit 或 push。

### 12. 明确不执行的验证

本任务不执行真实模型 API 测试。即使所有自动化通过，也只能结论为“直接任务路径在假模型和浏览器回归下通过”；真实模型耗时和成功率必须标记为“未验证”。如用户之后明确授权，可另开一次受控验证，只使用 `D:\codex-pj\time\docs\测试文档.md`，并限制为一次完整工作流。

任何无法执行的命令都必须记录准确命令、退出码和原始错误摘要，并标记为“未验证”，不得声称通过。

# 生成流程第一步性能优化设计

## 背景

当前“AI 拆解为任务”关键路径为：

1. 前端调用 `/api/time-management/intake/check`；
2. 前端调用 `/api/time-management/tasks/decompose`；
3. 服务端串行执行 `coach-analysis`；
4. 服务端串行执行 `task-generation`；
5. 两个阶段全部完成后，前端才进入任务确认页。

提交 `e50b9e6` 将正式拆解从一次模型调用改为两个串行模型阶段。当前测试明确要求正常路径调用模型两次。本机日志样本中，intake 校验为 5 ms，而 decompose 请求在 7,601 ms 后返回 502。

代码审查还确认：

- 每阶段最多重试一次，Structured Outputs 回退又可能增加请求，整条流程最多产生 8 次串行上游 fetch；
- `MODEL_TIMEOUT_MS` 只覆盖响应头之前，响应正文读取可无限等待；
- 浏览器取消没有传播到服务端模型请求；
- 任何 400、404、422 都可能触发无效回退；
- 前端和服务端重复校验同一份 intake；
- 当前日志无法分辨各模型阶段、尝试和回退耗时。

## 术语

- **模型阶段**：一次业务生成，例如任务拆解或教练诊断；
- **上游 attempt**：一次真实的供应商 HTTP fetch；
- **纠错轮次**：业务工作流因格式或语义失败再次生成；
- **正常快速拆解**：首轮联合输出通过所有 Schema 和语义校验，且供应商能力模式已确定；
- **任务可见**：第二步首个任务行已经进入 DOM。

## 目标

1. 任务可见的生产目标为 p95 不超过 5 秒；
2. 单次任务拆解 HTTP 请求必须在产品 deadline 12,000 ms 内成功或失败；
3. 正常快速拆解只执行 1 个模型阶段和 1 次上游 attempt；
4. 每个任务或教练阶段最多 1 次纠错；包含一次明确能力探测时，每阶段最多 3 次上游 attempt；
5. 教练诊断不阻塞任务确认、SMART、时间分布、优先级和报告流程；
6. 保留证据追踪、完成事项过滤、责任人和截止时间防幻觉约束；
7. 教练诊断失败时保留任务，并允许单独重试；
8. 客户端取消必须终止上游模型请求；
9. 新格式与已有历史数据兼容；
10. 运行日志和 attempt 元数据能够定位阶段、尝试、回退和耗时，但不得记录用户原文、模型正文、供应商正文或密钥。

5 秒是发布前 live 基准目标，不是强制取消点。12,000 ms 是产品硬截止时间；自动化测试允许最多 250 ms 的调度容差，但不得把产品 deadline 改成 12,250 ms。

历史中的 `decomposition.output` 是受用户认证、行级所有权、大小上限和现有保留策略保护的业务审计数据，可以保存模型候选输出。禁止原文和模型正文的范围仅指运行日志、异常对象和 attempt 元数据。

## 非目标

本次不实现：

- 服务端持久任务队列；
- 页面关闭后继续生成教练诊断；
- SSE、WebSocket 或逐 token 流式 UI；
- 跨会话恢复未完成诊断；
- 旧历史批量迁移；
- 多租户全局配额和计费系统；
- 更换当前 OpenAI-compatible 模型客户端。

## 方案比较

### 方案 A：复用旧 `extractTasks`，后台补教练诊断

优点：改动最小，正常路径一次模型调用。

缺点：旧输出没有 evidence 和 task-evidence 映射，状态、责任人和期限约束弱于当前正式流水线，审计能力明显退化。

### 方案 B：一次生成 `evidence + tasks`，后台生成 `coachingAnalysis`

优点：阻塞路径只有一次模型调用，同时保留证据和任务映射；教练诊断失败不影响任务。

缺点：需要新增提示词、响应契约、异步前端状态和历史兼容格式。

### 方案 C：保留当前两阶段，仅增加流式或异步包装

优点：任务质量约束变化最少。

缺点：任务阶段依赖教练阶段输出，关键路径仍是两次串行模型调用；流式输出在完整 JSON 和语义校验前不能安全展示。

## 决策

采用方案 B。

两名独立架构子 agent 均认可该方向；对抗评审结论为 `APPROVE_WITH_CHANGES`。本设计已纳入其要求：逐行证据定位、冻结 evidence 的可执行纠错、全响应 deadline、取消传播、安全回退、独立请求通道、历史条件补写和严格兼容。

## 目标数据流

```text
用户点击“AI 拆解为任务”
  → POST /api/time-management/tasks/decompose
  → 服务端校验 intake 并按行编号
  → 单次模型生成 evidence + tasks
  → 服务端执行 Schema、逐行证据、覆盖和任务语义校验
  → 任务标准化、SMART 初检
  → 返回任务并进入第二步
  → 前端不等待地发起 POST /api/time-management/tasks/coaching-analysis
  → 成功：合并 coachingAnalysis
  → 失败/超时/取消：保留任务，显示独立重试或不可用状态
```

服务端不得在返回任务后启动无持久化的 fire-and-forget Promise。后台仅表示前端不 `await` 的独立 HTTP 请求。

## 请求起点、取消与路由 deadline

在 `express.json()`、Session、认证和 CSRF 之前增加轻量中间件。中间件使用同一单调时钟域完成：

- 记录 `requestStartedAt`；
- 根据请求路径选择预算；
- 计算 `deadlineAt = requestStartedAt + routeBudgetMs`；
- 创建请求级 AbortController；
- 立即启动 deadline timer，不能只保存时间戳；
- timer 到期时以 `MODEL_TIMEOUT` reason 中止 controller；
- 响应仍可写时返回 504；
- 监听 `request.aborted`；
- 仅在 `!response.writableEnded` 时由 `response.close` 触发主动取消；
- 在 `finish`、`close` 和错误清理路径中清除 timer 并移除监听器。

路由预算：

- `/api/time-management/tasks/decompose`：12,000 ms；
- `/api/time-management/tasks/coaching-analysis`：12,000 ms，每次用户重试获得新的 HTTP 请求预算；
- 现有 goals、extract、matrix、report 等模型端点：保持现有 `MODEL_TIMEOUT_MS` 预算；
- 非模型路由不因本设计获得新的模型 deadline。

所有模型路由共享请求取消 signal，但不共享同一个固定 12 秒预算。模型调用的有效截止时间取路由 `deadlineAt` 与 `MODEL_TIMEOUT_MS` 推导截止时间中的较早者。

对于 decompose 和 coaching，body 解析、认证、业务工作流、模型调用和响应序列化都包含在 12,000 ms 内。

## 阻塞任务阶段

### 接口

保留现有：

```http
POST /api/time-management/tasks/decompose
```

请求仍为严格四栏 `entries`。前端删除此前独立的 `/intake/check` 调用；服务端端点继续自行校验，避免重复往返和重复鉴权。

### 输入规模

快速拆解新增 `DECOMPOSITION_ITEM_LIMIT = 12`：

- 四栏合计最多 12 个非空行；
- evidence 最多 12 条；
- tasks 最多 12 条；
- 超出时返回稳定 422 `DECOMPOSITION_ITEM_LIMIT_EXCEEDED`，提示拆分输入；
- 通用手工任务和历史任务的 `TASK_LIMIT = 100` 不变。

v2 模型字段上限独立于通用任务上限：

| 字段 | 上限 |
|---|---:|
| evidence.quote | 120 字符 |
| evidence.observation | 120 字符 |
| evidence.owner | 60 字符 |
| evidence.due | 40 字符 |
| task.name | 120 字符 |
| task.due | 40 字符 |
| task.est | 20 字符 |
| task.owner | 60 字符 |
| task.acceptanceCriteria | 最多 3 条，每条 120 字符 |
| task.nextAction | 120 字符 |

该约束同时用于 prompt、JSON Schema、语义校验、evaluator 和最大边界 fixture，避免 Schema 允许的合法输出超过模型和解析预算。

### 模型输出

新增版本化提示词：

```text
prompts/decomposition/evidence-task-generation.v2.1.md
```

运行时身份固定为：

- id：`decomposition.evidence-task-generation`；
- version：`2.1.0`；
- sha256：由 loader 对提示词正文计算的 64 位小写十六进制。

单次模型调用返回：

```json
{
  "evidence": [],
  "tasks": []
}
```

新增 `EVIDENCE_TASK_RESPONSE_SCHEMA`。每条 evidence 必须包含：

- `id`；
- `dimension`；
- `sourceLineIndex`，从 0 开始；
- `quote`；
- `observation`；
- `kind`；
- `status`；
- `owner`；
- `due`。

任务候选保留当前字段及 `evidenceIds`。`evidenceIds[0]` 明确定义为主证据。

### 服务端硬校验

服务端先用与 `checkIntake` 相同的拆行规则生成四栏行数组，再验证：

1. evidence ID 唯一；
2. `sourceLineIndex` 指向对应 dimension 的有效非空行；
3. quote 必须来自该索引对应的单行，不能只在整栏中匹配；
4. owner 和 due 必须由同一索引对应的单行支持；
5. 每个非空行索引必须至少被一条 evidence 覆盖；
6. 今天、明天、后天的每个 `planned` 或 `unfinished` evidence 必须成为至少一项任务的主证据；昨天的 actionable evidence 可以作为主证据，或作为被同一任务直接解决的关联证据；
7. `completed` 和 `not_actionable` evidence 不得被任何任务引用；
8. task 必须引用 evidence，且 source 与主 evidence 维度一致；
9. 临时任务、未来任务验收标准、超 8 小时任务拆分等现有规则继续执行；
10. 任务数量不得超过 `DECOMPOSITION_ITEM_LIMIT`；
11. 模型返回的 task due 先由服务端以主 evidence 的 due 覆盖，再执行 UUID、日期归一化、紧迫度和 SMART 检查。

### 纠错

工作流固定调用模型客户端 `maxAttempts: 1`，业务层最多执行 1 次纠错：

- evidence 非法：第二轮仍使用联合 Schema，重新生成完整 evidence + tasks；
- evidence 合法但 tasks 非法：第二轮只使用 `TASK_RESPONSE_SCHEMA`，输入包含冻结的首轮 evidence 和失败规则；
- 第二轮任务不得返回 evidence；
- 最终审计 output 由首轮冻结 evidence 与纠正后的 tasks 组装；
- 剩余 deadline 不足 2,000 ms 时不开始纠错。

如果首轮需要一次明确能力 fallback，能力模式在本次请求和进程缓存中已确定，纠错轮不再探测。每阶段上游 attempt 硬上限为 3。

### 响应

返回现有顶层 `intake`、`tasks`、`smart`，以及：

```json
{
  "decomposition": {
    "pipelineVersion": "task-first-v2",
    "decompositionId": "由服务端生成的 UUID",
    "businessDate": "业务日期",
    "stages": [
      {
        "name": "evidence-task-generation",
        "status": "succeeded",
        "prompt": {
          "id": "decomposition.evidence-task-generation",
          "version": "2.1.0",
          "sha256": "64 位小写十六进制"
        },
        "attempts": 1,
        "durationMs": 1234,
        "responseFormat": "json_object",
        "output": { "evidence": [], "tasks": [] }
      }
    ],
    "taskEvidence": []
  }
}
```

顶层 `tasks` 是标准化结果；阶段 output 保留模型候选，供审计比较。示例中的 UUID、日期、sha256 和 durationMs 均由运行时生成，不是配置占位值。

## 非阻塞教练诊断

### Prompt 身份

新增：

```text
prompts/decomposition/coaching-analysis.v2.md
```

运行时身份固定为：

- id：`decomposition.coaching-analysis`；
- version：`2.0.0`；
- sha256：由 loader 计算的 64 位小写十六进制。

### 请求契约

新增：

```http
POST /api/time-management/tasks/coaching-analysis
```

请求 Schema 使用 `additionalProperties: false`，必需字段为：

```json
{
  "decompositionId": "UUID",
  "attemptId": "UUID",
  "businessDate": "YYYY-MM-DD",
  "entries": {
    "昨天": "string",
    "今天": "string",
    "明天": "string",
    "后天": "string"
  },
  "evidence": []
}
```

服务端重新验证 entries、逐行 evidence、decompositionId 和 attemptId。该接口只生成 `coachingAnalysis`，不能返回或修改 tasks/evidence。

### 响应契约

响应 Schema 使用 `additionalProperties: false`，固定返回：

```json
{
  "decompositionId": "原样回显的 UUID",
  "attemptId": "原样回显的 UUID",
  "analysisId": "服务端生成的 UUID",
  "stage": {
    "name": "coaching-analysis",
    "analysisId": "与顶层相同的 UUID",
    "status": "succeeded",
    "prompt": {
      "id": "decomposition.coaching-analysis",
      "version": "2.0.0",
      "sha256": "64 位小写十六进制"
    },
    "attempts": 1,
    "durationMs": 1234,
    "responseFormat": "json_object",
    "output": { "coachingAnalysis": {} }
  }
}
```

`analysisId` 仅由服务端生成；顶层值必须与 stage 内值相同。coaching stage 和 History Schema 3 都把 `analysisId` 设为必需字段，供条件补写执行幂等判断。失败、超时或取消不得清空任务。

### 前端状态

```text
idle → running → succeeded
               → failed → running
               → timed_out → running
               → cancelled → running
               → unavailable
```

规则：

- 任务响应完成后先写入任务并进入第二步，再启动教练请求；
- 使用 `decompositionId + attemptId + requestSequence` 抑制迟到结果；
- 新拆解、修改四栏、重置或退出时取消旧教练请求；
- 普通步骤切换不取消；
- 教练失败显示独立重试，不回滚任务；
- 已成功结果不能被旧失败覆盖；
- 当前 UI 只增加简洁状态和重试入口，不新增完整教练展示页面；
- UTF-8 请求体超过 64 KiB 时进入 `unavailable`，显示 `COACHING_PAYLOAD_TOO_LARGE`，不提供重复发送相同 payload 的重试按钮；用户修改输入并重新拆解后才能恢复。

## 模型客户端

`createModelClient().completeJson()` 增加可选参数：

- `signal`：调用方取消信号；
- `deadlineAt`：绝对截止时间；
- `responseFormatMode`：`auto | json_schema | json_object`；
- `maxTokens`：阶段输出 token 上限；
- `maxContentBytes`：阶段 content 字节上限；
- `onAttempt`：仅接收安全元数据的回调。

### 全响应 deadline

deadline 覆盖：

- fetch 建连与响应头；
- 响应 body；
- envelope JSON 解析；
- Structured Outputs 回退；
- 格式纠错；
- 语义纠错。

每次 retry/fallback 使用同一 `deadlineAt`，不得重新获得完整 12 秒。

### 取消传播

信号链：

```text
浏览器 AbortController
  → Express 请求级 AbortController
  → workflow signal
  → modelClient.completeJson(signal)
  → 上游 fetch signal
```

主动取消后不得继续 fallback、重试或启动下一模型阶段。使用表驱动 API 测试覆盖所有模型路由。

### Structured Outputs 策略

新增环境变量：

```text
MODEL_RESPONSE_FORMAT_MODE=auto
MODEL_TASK_MAX_OUTPUT_TOKENS=16384
MODEL_COACH_MAX_OUTPUT_TOKENS=8192
```

教练 Schema 固定 18 个核心 claim；每个 claim text 最多 240 字符。`coaching_suggestions` 最多 3 条，issue、suggestion 和 coaching_question 各最多 240 字符。

`auto` fallback 必须同时满足：

1. HTTP 状态为允许集合中的 400 或 422；
2. 解析后 `error.param` 精确指向 `response_format` 或 `json_schema`；
3. `error.code` 位于提交的 allowlist fixture 中。

禁止只匹配 message。禁止因 404、401、403、409、429、5xx、上下文超限、模型不存在、endpoint 错误、Schema 自身非法或无法解析的错误体回退。

仓库必须提交脱敏供应商错误 fixture。确认不支持后，在进程内按 endpoint + model 缓存 `json_object` 能力。当前 DeepSeek 部署可显式配置 `json_object`，首请求不做能力探测。

### 响应字节预算

固定预算：

- 供应商错误正文：8 KiB，超限为 `MODEL_ERROR_BODY_TOO_LARGE`；
- 快速任务 content：64 KiB；
- 教练 content：32 KiB；
- content 超限统一为 `MODEL_OUTPUT_TOO_LARGE`；
- 模型 envelope：96 KiB，超限为 `MODEL_RESPONSE_ENVELOPE_TOO_LARGE`；
- 完整 decompose API JSON 响应：192 KiB，超限为 `API_RESPONSE_TOO_LARGE`；
- 完整 History Schema 3 请求与响应：`HISTORY_SNAPSHOT_MAX_BYTES`。该常量由最大合法历史 fixture 计算，加入 10% 结构余量后向上取整到 64 KiB 边界。

响应 body 使用流式限长读取；超过预算时取消 reader 和上游 signal，不能先完整分配后检查。

仓库提交同一套最大边界 fixture，并依次验证：

1. 实际配置模型 tokenizer 的 token 数不超过阶段 maxTokens；
2. 供应商 envelope 序列化后不超过 96 KiB；
3. 完整 decompose 响应（含顶层标准化 tasks 和阶段候选）不超过 192 KiB；
4. 最大 History Schema 3 fixture 必须包含 100 个最终任务，以及 goals、distribution、matrix、report、task-first decomposition 和 coaching 的全部通用字段最大值；序列化字节数加 10% 后用于生成 `HISTORY_SNAPSHOT_MAX_BYTES`。

前三项断言失败时，测试必须阻止发布；修正方式只能是继续收紧模型字段/数量上限，或在供应商明确支持时提高阶段 token 配置，不能静默截断业务 JSON。History fixture 变大时只允许同步提高认证后的 History 专用请求/响应预算，不得提高匿名、coaching 或普通接口上限。

### HTTP 请求体预算

重排 `server/app.js` parser 挂载顺序：

- deadline/cancel 中间件最先执行；
- `/api/auth` 和普通匿名 JSON 保持 64 KiB；
- `/api/time-management` 先执行 Session、认证、Origin 和 CSRF；
- 普通 time-management 写请求在认证后使用 64 KiB parser；
- History Schema 3 创建在认证后使用 `HISTORY_SNAPSHOT_MAX_BYTES` parser；
- coaching 补写请求保持 64 KiB，因为只允许提交一个受限 coachingStage；
- History GET 响应使用同一 `HISTORY_SNAPSHOT_MAX_BYTES` 上限；
- 不提高匿名全局 parser 上限。

coaching 请求仍受 64 KiB 限制；前端预检和服务端 413 必须一致。

## 错误分类

- deadline 触发：`MODEL_TIMEOUT`，HTTP 504，前端 `timed_out`；
- 调用方 signal 触发：内部 `MODEL_CANCELLED`；响应仍可写时映射 `REQUEST_CANCELLED`，HTTP 499，前端 `cancelled`；
- payload 超过 64 KiB：`COACHING_PAYLOAD_TOO_LARGE`，HTTP 413，前端 `unavailable`；
- 首个触发的 AbortSignal reason 决定 timeout/cancel 分类；
- timeout 和 cancel 均禁止 fallback 与 retry；
- 任何错误不得包含用户原文、模型正文、供应商错误正文、堆栈或密钥。

## 前端请求通道

把单一 `activeController` 改为按通道保存：

- `foreground`：拆解、SMART、时间分布、矩阵、报告；
- `coaching`：后台教练诊断；
- `history-read`：可 latest-wins 取消的历史读取；
- `history-write`：不可 latest-wins 取消的历史写入。

History 写操作按 `clientRunId + decompositionId` 串行化，并复用同一 in-flight Promise。coaching 完成和历史保存回调不得互相取消。

前端记录 `performance.now()` 的任务可见差值，仅供开发测试。生产 p95 必须由明确的 live E2E benchmark 制品计算，不能从单个浏览器内存值推断。

## History 兼容

新增 history schema version 3：

- `pipelineVersion: task-first-v2`；
- 必需 `evidence-task-generation` 成功阶段；
- `coaching-analysis` 为可选成功阶段；成功阶段必须包含服务端生成的 `analysisId`；
- 缺失 coaching 表示未保存，不持久化永久 pending；
- prompt id/version 使用上述常量，sha256 使用 64 位小写十六进制 pattern；
- 保留 taskEvidence。

兼容规则：

1. Schema 1 原样读取；
2. Schema 2 继续按旧 `coach-decompose-v1` 严格校验；
3. Schema 3 同时读取任务提示词 2.0.0 与 2.1.0：2.0.0 保持所有 actionable evidence 必须为主证据，2.1.0 允许昨天 actionable evidence 作为直接相关的辅助证据；
4. 不改写旧行；
5. 每日跟踪继续只读取最终 tasks。

### 条件补写

新增：

```http
PATCH /api/time-management/history/:id/coaching-analysis
```

请求 body 只能是：

```json
{
  "decompositionId": "UUID",
  "analysisId": "UUID",
  "coachingStage": {}
}
```

规则：

- 必须认证、同源和 CSRF；
- 使用 `BEGIN IMMEDIATE`；
- 按 `id + user_id + schema_version = 3` 读取；
- 服务端把 coachingStage 追加到已有 decomposition，客户端不能提交完整 decomposition_json；
- body 的 analysisId 必须与 coachingStage.analysisId 相同；
- 验证同一 decompositionId、完整合并快照和 evidence 引用；
- 其他用户记录与不存在记录统一返回 404；
- 相同 analysisId 幂等返回 200，且不更新 `updated_at`；
- 已有不同 analysisId 返回 409，不覆盖；
- 只能修改 decomposition_json 和 updated_at。

前端在“历史保存完成”和“coaching 完成”两个回调中调用同一个串行、幂等同步函数，覆盖两种完成顺序。

## 可观测性

每次上游 fetch 计为一个 attempt。stage `attempts` 是该阶段上游 fetch 总数，`responseFormat` 是最终成功格式，`fallbackUsed` 表示是否发生能力降级。

每次 attempt 记录：

- requestId；
- decompositionId；
- stage；
- attempt 序号；
- responseFormat；
- fallbackUsed；
- status；
- durationMs；
- safe error code。

route 通过闭包把 requestId、decompositionId 和 stage 注入 `onAttempt`，再调用现有 logger。`onAttempt` 异常必须被吞掉，不得影响业务请求。

不得记录 prompts、entries、evidence、tasks、模型正文、供应商正文或认证信息。响应 decomposition stage 保存聚合后的 attempts、durationMs 和 responseFormat，不保存供应商错误详情。

## 测试策略

### 模型客户端

- headers 返回后 body 永久挂起仍按 deadline 超时；
- caller signal 取消上游 fetch；
- fallback 与纠错共享 deadline；
- 通用 404/400/422 不回退；
- 状态、param 和 allowlist code 同时匹配时回退并缓存；
- Schema 非法错误不回退、不写能力缓存；
- timeout、cancel 和上游错误分类稳定；
- maxTokens 写入请求；
- 流式字节预算和稳定错误码；
- 错误和日志不泄漏正文。

### 快速任务工作流

- 正常成功只有 1 个模型阶段和 1 次上游 attempt；
- 每个非空输入行索引均有 evidence；
- quote、owner 和 due 只能由同一行支持；
- 今天、明天、后天的 actionable evidence 均有主任务，昨天的 actionable evidence 均被主任务或直接相关任务覆盖；
- completed/not_actionable 零泄漏；
- 首轮 evidence 合法而 task 非法时使用 TASK_RESPONSE_SCHEMA 并冻结 evidence；
- deadline 不足时不纠错；
- 超过 12 行稳定拒绝；
- 最大合法 task-first content fixture 不超过 64 KiB，完整 API 响应不超过 192 KiB；
- 任务来源、临时任务、验收标准和超大任务规则保持。

### 教练工作流

- 只能引用已验证 evidence；
- 无证据 claim 必须以“证据不足”开头；
- 不得修改 tasks/evidence；
- 最大合法 coaching content fixture 不超过 32 KiB；
- 失败、超时和取消不影响任务状态；
- payload 过大进入 unavailable，不重复相同请求；
- 重试成功只更新教练状态。

### API 与安全

- 新接口要求认证、Origin 和 CSRF；
- 所有模型路由在请求断开后取消上游且不发送第二次请求；
- 未知字段和用户注入的模型配置被拒绝；
- 旧 `/tasks/decompose` URL 保持可用；
- 日志只含安全元数据。

### 前端与竞态

- 教练永不返回时，任务仍先显示且后续步骤可用；
- foreground 和 coaching 不互相取消；
- history POST/PATCH 不互相取消；
- 新拆解后旧教练结果不能写回；
- 教练失败提供重试且不清空任务；
- 历史先保存、教练先完成及交叉完成的最终结果一致。

### History

- Schema 1、旧 Schema 2、新 Schema 3 均可读取；
- Schema 3 可缺少 coaching；
- PATCH 只接受 coachingStage；
- 条件补写幂等；
- 不同迟到结果不覆盖；
- 跨用户访问统一 404；
- 补写不改变 tasks、distribution、matrix 或 report。

### 自动测试命令

新增：

```text
npm run test:performance
```

该命令执行明确的无付费模型测试文件，并覆盖：

- 单阶段假模型延迟不会被重复相加；
- terminal 结果在 12,000 ms deadline 加 250 ms 测试调度容差内结束；
- 任务进入 DOM 不等待教练请求。

`npm test` 依次运行 server、replay evaluator、performance 和 E2E。新增 DOM 竞态测试放入现有 Playwright `testMatch` 文件，或同步扩展 `testMatch`，避免测试未被发现。

完整验证只需执行：

```text
npm test
```

### 真实模型发布基准

新增显式命令：

```text
npm run benchmark:decomposition:live
```

该命令可能产生模型费用，不纳入默认自动流程。运行要求：

- 明确费用授权；
- 同一供应商、模型版本和固定代表性数据集；
- 至少 100 个 actionable 请求；
- 使用 MutationObserver 测量点击至首个任务节点；
- 使用 nearest-rank 计算 p95；
- 保存脱敏 JSON 制品，包含模型、版本、数据集 hash、样本数、成功率和延迟分位数；
- 任务 precision、recall、F1 不低于当前两阶段基线或均不低于 0.95；
- p95 不超过 5 秒；
- terminal 结果不超过产品 deadline 12,000 ms。

未获得费用授权时，提交和 push 可以完成，但必须明确报告真实模型 p95 尚未验证，不能宣称达到生产指标。

## 验收标准

### 功能与质量

- 正常快速拆解只有 1 个模型阶段和 1 次上游 attempt；
- 现有 17 个 replay 案例全部通过；
- 每个非空输入行均被 evidence 覆盖；
- 今天、明天、后天的 planned/unfinished evidence 均有主任务，昨天的 planned/unfinished evidence 均被主任务或直接相关任务覆盖；
- completed leakage、owner hallucination、due hallucination 均为 0；
- 教练失败不阻塞任务和后续步骤；
- 旧历史继续可读。

### 性能与可靠性

- 任务可见 live benchmark p95 ≤ 5 秒；
- 产品 deadline 保持 12,000 ms；自动测试允许 250 ms 调度容差；
- body 永久挂起能够超时；
- cancel 后不发送 fallback 或 retry；
- DeepSeek 显式 `json_object` 模式不先发送必失败的 strict 请求；
- 相同输入不再执行独立 intake/check 往返。

### 安全

- 新 POST/PATCH 均有认证、CSRF 和同源保护；
- 用户不能读取或修改其他用户历史；
- 用户输入、模型正文、供应商错误正文和密钥不进入日志；
- 请求、错误正文、模型 envelope、content 和 API 响应均有明确字节上限；
- PATCH 不能替换客户端提交的完整 decomposition。

## 实施顺序

1. 为 model client 的 deadline、流式 body、取消和 fallback 写失败测试；
2. 实现并验证 transport 修复及所有模型路由 signal；
3. 为联合 evidence+tasks 契约、逐行覆盖和冻结纠错写失败测试；
4. 实现 task-first workflow 和提示词；
5. 实现 coaching workflow 和 API；
6. 改造前端请求通道、状态机和重试；
7. 实现 History Schema 3 和条件补写；
8. 更新 evaluator、performance 和 E2E；
9. 运行 `npm test`、独立代码审查和端到端无付费验证；
10. 提交并 push 功能分支。

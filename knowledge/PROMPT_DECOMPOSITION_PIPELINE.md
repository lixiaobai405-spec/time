# 时间管理教练拆解流水线

## 1. 改造目标

旧实现将“事实识别、完成状态判断、管理诊断、任务拆分、重要性和紧急度判断”放在一次模型调用中。该设计存在三个主要问题：

1. 无法区分模型从原文提取的事实和模型生成的管理判断。
2. 任务无法追溯到原文证据，遗漏和幻觉只能依赖最终结果人工发现。
3. 仅使用 `json_object`，只能约束为合法 JSON，不能保证字段和枚举契约。

新实现把前端正式使用的 `/api/time-management/tasks/decompose` 改为两阶段流水线；旧 `/tasks/extract` 继续保留，避免一次性破坏兼容接口。

## 2. 注入位置

```text
prompts/decomposition/*.md
        ↓ loadVersionedPrompt
server/workflows/decompose-tasks.js
        ↓ completeJson(responseSchema)
server/model/model-client.js
        ↓ POST /chat/completions
模型供应商
```

旧步骤提示词仍由：

```text
prompts/system.md
        ↓ loadStepPrompt
check-goals / extract-tasks / classify-matrix / generate-report
```

加载。当前只有正式“拆解”入口切换到新流水线。

## 3. 新流水线

### 阶段 A：证据化教练诊断

输入：四栏原文和服务端计算的上海业务日期。

输出：

- `evidence[]`：原文连续引用、所属维度、规范化观察、状态、原文明示责任人和期限；
- `coachingAnalysis`：用户原版教练提示词中的昨天、今天、明天、后天、逻辑链和建议；
- 每条分析结论必须通过 `evidenceIds` 引用证据；无证据时必须明确写“证据不足”。

服务端校验：

- `quote` 必须真实存在于对应栏位原文；
- `owner` 和 `due` 非“待确认”时必须能在原文中找到；
- 证据 ID 不重复；
- 分析不能引用不存在的证据；
- 无证据结论必须明确标记为证据不足。

### 阶段 B：基于证据生成任务

输入：四栏原文、业务日期、阶段 A 的证据和教练诊断。

输出：任务候选及 `evidenceIds`。

服务端校验：

- 每条任务必须引用证据；
- 主要证据维度必须和任务 `source` 一致；
- 已完成或不可行动证据不能生成任务；
- 昨天的 `unfinished` 证据必须至少生成一个 `复盘` 来源任务；
- 责任人和期限不得超出主要证据；
- 中短期任务必须有验收标准；
- 超过 8 小时的大任务按既有规则拆分或给出下一步。

模型结果通过后，服务端继续确定性执行：

- UUID 生成；
- 日期标准化；
- 截止日期和紧迫信号驱动的紧急度纠偏；
- SMART 校验；
- 每日跟踪合并和跨日未完成任务滚动。

## 4. 模型与硬编码职责边界

| 职责 | 执行位置 | 原因 |
|---|---|---|
| 原文语义分段、事实类型、状态初判 | 模型阶段 A | 需要自然语言理解 |
| 管理教练诊断、逻辑链、授权建议 | 模型阶段 A | 属于开放式语义判断 |
| 从已验证证据生成任务表述 | 模型阶段 B | 需要语义归纳和任务命名 |
| JSON 字段、枚举、长度、数量 | JSON Schema + AJV | 可确定性验证，不应交给模型自律 |
| quote 是否存在于原文 | 服务端 | 可直接复核 |
| owner/due 是否有原文依据 | 服务端 | 防止模型推断 |
| 昨天未完成证据是否被覆盖 | 服务端 | 产品强规则，必须硬保证 |
| 日期归一化、紧急度期限规则 | 服务端 | 时间规则应一致且可复算 |
| UUID、任务守恒、每日滚动 | 服务端 | 数据完整性规则 |

## 5. Structured Outputs 与兼容策略

模型客户端在传入 Schema 时优先发送：

```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "...",
    "strict": true,
    "schema": {}
  }
}
```

如果 OpenAI-compatible 供应商对该能力返回 400、404 或 422，客户端仅回退一次到 `json_object`；回退结果仍必须通过本地 AJV Schema 和语义校验。

这避免把供应商兼容性等同于降低应用层校验强度。

## 6. 重试策略

每个阶段最多两次模型输出：

1. 首次输出先经过 JSON Schema 和语义规则校验；
2. 失败时只把固定失败规则码和修正方向注入第二次请求；
3. 不把用户原文、模型原始错误正文或内部堆栈写入错误响应；
4. 超时和上游不可用不自动重试，避免隐藏延迟和重复计费。

## 7. 版本和审计留存

每个提示词文件有独立：

- `prompt.id`
- `prompt.version`
- `prompt.sha256`

历史快照新增可空 `decomposition_json`，保留：

- 流水线版本；
- 业务日期；
- 两阶段提示词版本和哈希；
- 两阶段完整 JSON 输出；
- 模型生成任务到证据 ID 的映射。

用户在“AI 拆解确认”页编辑、删除模型任务或新增手动任务时，原始拆解轨迹不会被覆盖；最终任务继续单独保存在 `tasks_json`。因此可以比较“模型原始候选”和“最终采用版本”。

旧历史仍使用 `schema_version=2`，`decomposition_json` 为 NULL 时可以正常读取。历史详情页提供折叠的审计 JSON 查看入口。

## 8. “昨天”与每日跟踪

两类规则相互独立：

1. 本次输入的“昨天”栏：阶段 A 标成 `unfinished` 后，阶段 B 必须生成 `source=复盘` 的任务；生成报告后，该任务会进入当天每日跟踪。
2. 前一业务日每日跟踪：服务端 `daily-tracking/service.js` 会读取最近一次日快照，只把未勾选且未删除的任务滚入新的上海业务日；已完成或已删除任务不会滚入。

因此任务可以保持“昨天/复盘”这一来源类别，同时出现在今天的执行清单中，不需要篡改来源来实现滚动。

## 9. 评测和发布门槛

固定评测数据位于 `tests/evals/decomposition-cases.jsonl`。首批 16 个虚构案例覆盖：

- 昨天明确完成、明确未完成和混合状态；
- 昨天无完成标志但仍可执行的模糊状态；
- 无标点动作链；
- 多责任主体、接收人和抄送人；
- 相对期限、当天期限和长期期限；
- 临时突发事项；
- SMART 多交付物；
- 超过 8 小时的长期任务；
- 四维混合输入；
- 空泛愿望和无可执行内容；
- 原因未知时的根因证据不足。

离线黄金回放：

```text
npm run eval:decomposition
```

该模式把固定标注编译成两阶段模拟模型输出，验证流水线、Schema、语义门禁和指标计算，不访问外部 API。当前基线为 16/16 通过。

真实模型评测：

```text
npm run eval:decomposition:live
```

该模式把同一批虚构输入发送给当前配置的模型，计算：

- 案例通过率；
- 任务 precision、recall 和 F1；
- 证据状态、类型、责任人和期限准确率；
- 昨天未完成事项覆盖率；
- 完成事项进入待办的泄漏数；
- 责任人和期限幻觉数；
- 根因未知时是否明确标记证据不足。

当前自动化门槛：

- 证据 quote 必须可回查；
- 昨天未完成证据遗漏时必须失败并定向重试；
- 昨天已完成证据不能生成任务；
- Structured Outputs 请求和兼容回退均有测试；
- 中间 JSON 可通过历史契约往返；
- 每日跟踪跨日仅滚动未完成任务；
- 评测器对额外任务、虚构证据和指标口径错误能够报警。

每次变更提示词、模型版本或供应商前，应先运行离线回放，再运行固定模型评测并保存失败案例。离线 100% 只说明工程契约没有回归，不代表真实模型语义质量达到 100%。

## 10. 依据

- OpenAI Prompt Engineering：明确、分层的指令和输入边界。
  - https://developers.openai.com/api/docs/guides/prompt-engineering
- OpenAI Structured Outputs：优先使用严格 JSON Schema，而不是仅保证合法 JSON 的 JSON mode。
  - https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI API backward compatibility：模型行为可能随版本变化，建议固定模型版本并实施 evals。
  - https://platform.openai.com/docs/api-reference/backward-compatibility
- OpenAI Evals：使用可重复评测集持续验证模型和提示词变化。
  - https://developers.openai.com/api/docs/guides/evals
- Anthropic Prompt Engineering：复杂任务采用 prompt chaining，将中间结果传给后续步骤并在节点间设置检查。
  - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#chain-complex-prompts

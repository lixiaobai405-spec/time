# 时间管理助手 · 对抗式审查复核

原审查日期：2026-07-16

复核日期：2026-07-19

## 结论

**本期范围结论：可以进入甲方 v1 验收。** 四步页面已由真实服务端 API 驱动，确定性业务契约、安全边界和会话状态均有假模型自动化证据。

**生产上线结论：仍为 Request changes。** 本项目没有执行真实模型质量评测、供应商隐私评估、账号权限、生产部署、日期/工时容量建模或完整无障碍审计；这些事项不因代码存在而视为解决。

独立 v2 提示词仍是运行真源。甲方原始资料只用于只读核对，旧版 `docs/legacy-combined.md` 仅供追溯，不参与运行。

## 已解决（有测试证据）

### 核心流程消费用户当前输入

四栏目标、API 提取任务、手动任务、矩阵和报告统一进入 `frontend/state.js`。目标或任务变化会使下游结果失效，重新梳理会取消请求并清空会话状态。

证据：`tests/frontend.spec.js` 中“四个 API 请求使用用户当前输入和编辑后任务”“用户输入会真实贯穿任务、矩阵和报告”“新增或删除任务后必须重新判定矩阵”。

### PDCA/SMART 检查与步骤阻断

目标检查使用步骤 1 的结构化 API 响应；`overall=need_fix` 只能在对应输入框下展示 issue、suggestion 和“采纳建议”，不能进入任务提取。

证据：`tests/server/check-goals.test.js`、`tests/server/prompt-contract.test.js`、`tests/frontend.spec.js`。

### 矩阵数学契约与任务守恒

服务端固定写入 55/25/15/5，严格合计 100；只有“高”映射为重要或紧急。分类按稳定 `taskId` 守恒，同名任务不合并，空象限允许存在，五条第一象限任务触发过载提示。

证据：`tests/server/contracts.test.js`、`tests/server/classify-matrix.test.js`、`tests/server/prompt-contract.test.js`。

### 任务状态与请求生命周期

任务、矩阵、报告和 pending/error 进入单一状态树；请求可以取消，旧结果不能回写。手动未标注任务保持 `null/null`，矩阵补齐后标记 `ai-matrix` 并显示“AI 判定”。

证据：`tests/frontend.spec.js`、`tests/server/extract-tasks.test.js`、`tests/server/classify-matrix.test.js`。

### 提示注入、输入限制和输出验证

用户正文只进入 user JSON，不拼接 system prompt。请求与模型响应有大小、Schema、枚举、数量、任务守恒和报告引用校验；非法输出最多重试一次，错误响应不暴露模型原文或堆栈。

证据：`tests/server/security.test.js`、`tests/server/model-client.test.js` 及四个工作流测试文件。

### 规范漂移

正式契约明确了来源枚举、pending/done、截止时间“待确认”、稳定 UUID、已完成复盘事实不生成待办，以及高/中/低到象限的映射。提示词输出示例与测试同步。

证据：`tests/server/contracts.test.js`、`tests/server/extract-tasks.test.js`、`tests/server/prompt-contract.test.js`。

### 会话隐私与日志

页面展示会话隐私提示；服务端前端不含模型密钥，API 设置安全头和请求 ID，注入日志器时仅记录 requestId、路径、状态、耗时。

证据：`tests/server/security.test.js`、`tests/frontend.spec.js`。

### 模型测试可执行性

确定性用例已使用假模型自动化，主路径用 Playwright 验证四个请求体。自然语言质量用例明确保留为人工/模型评测。

证据：`tests/server/prompt-contract.test.js`、`tests/frontend.spec.js`、`tests/prompt-cases.md`。

## 仍未解决

### 日期、工时和容量模型

当前 `due` 与 `est` 仍是受长度限制的文本，没有 referenceDate、timezone、工作日历、过去日期判断、分钟数或团队可用容量。该能力不在 v1 正式范围内，不能用于自动排期或容量承诺。

### 真实模型质量与稳定性

自动测试全部使用假模型，只证明契约、重试和界面数据流。PDCA/SMART 判断质量、任务拆分质量与报告建议质量仍需按 `tests/prompt-cases.md` 记录真实模型名、日期、通过项和失败样例；调用真实付费 API 前必须另行确认。

### 生产隐私与访问治理

当前证明了“无持久化、无敏感正文日志、密钥不下发前端”，但尚未评估真实供应商的数据用途、保留期限、删除机制、区域合规，也没有账号、认证或权限控制。

### 完整无障碍与兼容性

已有键盘可聚焦控件、移动端布局和横向溢出回归，但没有引入专门的无障碍扫描，也未覆盖所有屏幕阅读器和浏览器组合。原审查中的完整 label 关联与动态提示语义不能仅凭现有代码关闭。

### 压力、日期边界和生产运行

已有 64KB 请求、64KB 模型正文、100 条任务等边界测试，但没有千条任务、持续并发、闰日、跨时区或生产负载测试；也没有部署与监控验证。

## 范围外事项

本期不新增账号、数据库、历史记录、跨会话记忆、教练助手依赖、外部平台集成或部署功能。上述缺失不作为 v1 会话内助手的阻断项，但在生产扩展前必须重新立项和评审。

# 时间管理助手 · 对抗式审查复核

原审查日期：2026-07-16

复核日期：2026-07-23

## 结论

**本期范围结论：可以进入参考界面与五步后端 v2 本地验收。** 新版工作台、五步页面、每日跟踪、用户名密码认证、恢复码、SQLite Session 和按用户隔离的报告历史均有假用户、临时 SQLite、假模型和 Playwright 自动化证据。

**生产上线结论：仍为 Request changes。** 本轮没有部署、没有执行真实模型质量评测或供应商隐私评估。HTTP 传输未加密、`User=root` 权限放大以及同盘单份备份不能防止整盘故障，均是已知且由项目所有者接受的剩余风险，不得描述为已消除。

`prompts/system.md` 的五步 v3 说明仍是运行真源。甲方参考 HTML 是新版界面与交互基准；旧版 `docs/legacy-combined.md` 和旧四步 Playwright 用例仅供追溯，不参与当前正式 testMatch。

## 2026-07-22 新版参考界面复核

### 已关闭：界面只是静态复刻、后端仍为旧四步

新版页面依次调用四栏校验、任务拆解、SMART 校验、时间分布诊断、矩阵和报告接口。第三步时间分布由服务端按分钟确定性计算，第五步报告请求必须携带该诊断结果；前端没有使用参考稿中的内存假解析器替代模型。

证据：`tests/server/five-step-api.test.js`、`tests/server/intake-smart-distribution.test.js`、`tests/server/generate-report.test.js`、`tests/reference-five-step.spec.js`。

### 已关闭：参考页面破坏真实认证与历史

注册、登录、恢复码、Session CSRF、账号报告保存和用户隔离保持原服务端实现；每日跟踪和本次会话历史只在浏览器内存中，账号历史仍写入 SQLite。刷新后草稿和本次会话记录清空，不混称为持久化历史。

证据：`tests/reference-auth-history.spec.js`、`tests/server/auth-api.test.js`、`tests/server/history-api.test.js`、`tests/server/security.test.js`。

### 已关闭：启动只显示“加载应用失败”且无法定位

已恢复依赖，开发启动器在 `.env` 存在时安全加载，启动入口输出具体配置错误；健康接口和首页均实测返回 HTTP 200。真实 AI 节点仍要求合法模型配置。

### 已关闭：精确 Node 20.20.2 运行时与启动脚本门禁

使用 `npx -y node@20.20.2 --test` 在精确 Node 20.20.2 下执行完整服务端套件，结果为 210/210 通过。`start.bat` 的 CRLF、项目环境、`.env` 安全加载和 `cmd.exe` 可执行性测试全部通过；同时增加系统 Node 回退，项目 `.conda` 缺失时不再直接退出，而是明确告警后继续启动。

依赖审计 `npm audit --omit=dev` 返回 0 个已知漏洞；`git diff --check` 通过。

## 已解决（历史与现行测试证据）

### 账号认证与历史已解决

注册、登录、退出、当前用户、恢复码重置和轮换已完成；密码使用固定参数的异步 scrypt，恢复码和 Session ID 只以哈希落库。CSRF、Origin/Host 校验和注册/登录/找回限流已覆盖。

已完成报告以 `(user_id, client_run_id)` 幂等保存，列表使用游标分页；详情和删除始终附带服务端 Session 中的 `user_id`，跨用户和不存在记录统一返回 404。前端在报告先渲染后异步保存，保存失败不覆盖报告，可使用同一 `clientRunId` 重试。

证据：`tests/server/auth-api.test.js`、`tests/server/recovery-api.test.js`、`tests/server/auth-security.test.js`、`tests/server/history-api.test.js`、`tests/server/history-repository.test.js`、`tests/reference-auth-history.spec.js`。

### 核心流程消费用户当前输入

四栏目标、API 提取任务、手动任务、矩阵和报告统一进入 `frontend/state.js`。目标或任务变化会使下游结果失效，重新梳理会取消请求并清空会话状态。

证据：`tests/reference-five-step.spec.js`、`tests/server/five-step-api.test.js`、`tests/server/generate-report.test.js`。

### PDCA/SMART 检查与步骤阻断

目标检查使用步骤 1 的结构化 API 响应；`overall=need_fix` 只能在对应输入框下展示 issue、suggestion 和“采纳建议”，不能进入任务提取。

证据：`tests/server/check-goals.test.js`、`tests/server/intake-smart-distribution.test.js`、`tests/server/prompt-contract.test.js`、`tests/reference-five-step.spec.js`。

### 矩阵数学契约与任务守恒

服务端固定写入 55/25/15/5，严格合计 100；只有“高”映射为重要或紧急。分类按稳定 `taskId` 守恒，同名任务不合并，空象限允许存在，五条第一象限任务触发过载提示。

证据：`tests/server/contracts.test.js`、`tests/server/classify-matrix.test.js`、`tests/server/prompt-contract.test.js`。

### 任务状态与请求生命周期

任务、矩阵、报告和 pending/error 进入单一状态树；请求可以取消，旧结果不能回写。手动未标注任务保持 `null/null`，矩阵补齐后标记 `ai-matrix` 并显示“AI 判定”。

证据：`tests/reference-five-step.spec.js`、`tests/server/extract-tasks.test.js`、`tests/server/classify-matrix.test.js`。

### 提示注入、输入限制和输出验证

用户正文只进入 user JSON，不拼接 system prompt。请求与模型响应有大小、Schema、枚举、数量、任务守恒和报告引用校验；非法输出最多重试一次，错误响应不暴露模型原文或堆栈。

证据：`tests/server/security.test.js`、`tests/server/model-client.test.js` 及四个工作流测试文件。

### 规范漂移

正式契约明确了来源枚举、pending/done、截止时间“待确认”、稳定 UUID、已完成复盘事实不生成待办，以及高/中/低到象限的映射。提示词输出示例与测试同步。

证据：`tests/server/contracts.test.js`、`tests/server/extract-tasks.test.js`、`tests/server/prompt-contract.test.js`。

### 草稿、历史与日志边界

页面明确告知“草稿不会保存，已完成报告会保存到账号历史”。服务端与前端不含模型密钥；日志仅记录 requestId、路径、状态和耗时，不记录用户名、密码、恢复码、Cookie、Session token、目标正文或历史正文。

证据：`tests/server/security.test.js`、`tests/reference-auth-history.spec.js`、`tests/reference-five-step.spec.js`。

### 模型测试可执行性

确定性用例已使用假模型自动化，主路径用 Playwright 验证五步接口的数据贯穿。自然语言质量用例明确保留为人工/模型评测。

证据：`tests/server/prompt-contract.test.js`、`tests/reference-five-step.spec.js`、`tests/prompt-cases.md`。

## 仍未解决

### 日期、工时和容量模型

`due` 仍是受长度限制的文本，系统没有完整工作日历、团队容量或生产级自动排期。新版时间分布只确定性解析明确的 `h`、`小时` 和 `分钟`，无法解析的工时会被排除并返回给前端；这只能支持结构诊断，不能用于容量承诺。报告调度继续使用服务端 Asia/Shanghai 参考日期和有限的明确时间冲突检查。

### 真实模型质量与稳定性

自动测试全部使用假模型，只证明契约、重试和界面数据流。PDCA/SMART 判断质量、任务拆分质量与报告建议质量仍需按 `tests/prompt-cases.md` 记录真实模型名、日期、通过项和失败样例；调用真实付费 API 前必须另行确认。

### 生产传输与运维风险

当前使用 HTTP `8011`，用户名、密码、恢复码、Cookie 和历史正文在传输中没有加密。固定公网 IP `/32` 白名单只降低暴露面，不能替代 HTTPS。`time.service` 仍以 root 运行，依赖或应用漏洞可能扩大到 ECS 其他 root 可读文件。同盘单份备份无法应对整盘故障、实例丢失或入侵者同时删除正式库与备份。

真实模型供应商的数据用途、保留期限、删除机制和区域合规仍未评估。

### 完整无障碍与兼容性

已有键盘可聚焦控件、移动端布局和横向溢出回归，但没有引入专门的无障碍扫描，也未覆盖所有屏幕阅读器和浏览器组合。原审查中的完整 label 关联与动态提示语义不能仅凭现有代码关闭。

### 压力、日期边界和生产运行

已有 64KB 请求、64KB 模型正文、100 条任务等边界测试，但没有千条任务、持续并发、闰日、跨时区或生产负载测试；本轮也没有执行部署、数据库恢复演练或监控验证。

## 范围外事项

本期仍不新增邮箱/SMTP/短信/社交登录、管理员后台、团队权限、草稿恢复、跨账号共享、教练助手依赖或外部平台集成。本轮未执行生产部署、未调用真实付费模型。

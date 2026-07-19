# 时间管理助手（time）

面向管理者的会话内时间管理助手。用户依次完成“目标梳理 → 任务提取 → 矩阵判定 → 优先级报告”，前端通过四个服务端 API 使用当前输入生成结果，不再使用固定演示任务或固定报告。

## 当前能力

- “昨天—今天—明天—后天”四栏目标输入，按 PDCA 和 SMART 返回字段级 `issue`、`suggestion` 与“采纳建议”。
- `overall=need_fix` 时阻止任务提取；修改目标后必须重新检查。
- AI 提取任务并生成稳定 UUID；未提供截止时间统一显示“待确认”。
- 支持手动新增和删除任务。手动任务可以不标注重要性/紧急度，保存为 `null/null`，矩阵判定后显示“AI 判定”。
- 重要/紧急矩阵只有“高”映射为“是”，精力比例由服务端固定为 55/25/15/5。
- 报告只按当前 `taskId` 引用任务，叙述字段通过安全 Markdown 渲染，可复制当前页面报告。

`prompts/system.md` 是四步运行提示词真源；`server/contracts/time-management.js`、各工作流的 Ajv Schema 和自动化测试共同约束运行数据。

## 环境要求

- Windows PowerShell
- Anaconda 或 Miniconda
- Node.js 20（本项目已验证 Node.js 20.20.2）
- Chromium（由 Playwright 安装）

为避免污染其他项目，推荐使用项目目录内的专用 Anaconda 环境 `.conda`：

```powershell
conda create --prefix .\.conda -c conda-forge python=3.12 nodejs=20 -y
conda activate .\.conda
npm.cmd ci
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npx.cmd playwright install chromium
```

`.conda/`、`.conda-pkgs/`、`.npm-cache/`、`node_modules/` 和测试产物均已加入 `.gitignore`。

## 服务端配置

服务端直接读取进程环境变量，不会自动加载真实 `.env`。变量名和假占位值见 `.env.example`：

| 变量 | 必填 | 说明 |
|---|---:|---|
| `PORT` | 否 | 本地端口，默认 `4174` |
| `MODEL_API_BASE_URL` | 是 | OpenAI 兼容接口的基础 URL，服务端会请求 `/chat/completions` |
| `MODEL_API_KEY` | 是 | 只允许注入服务端进程，不得写入前端 |
| `MODEL_NAME` | 是 | 模型名称 |
| `MODEL_TIMEOUT_MS` | 否 | 单次模型请求超时，默认 `30000` |

获得真实供应商配置并确认费用与数据政策后，在当前 PowerShell 会话中安全注入这些变量，再启动：

```powershell
conda activate .\.conda
npm.cmd run dev
```

访问 `http://127.0.0.1:4174/`。不要把真实 key 写入 `.env.example`、源码、测试或文档。

## API

四个接口均为 `POST`、`application/json`，模型格式或语义错误最多自动重试一次。

| 接口 | 请求核心字段 | 响应核心字段 |
|---|---|---|
| `/api/time-management/goals/check` | `goals` 四栏字符串 | `fields`、`overall` |
| `/api/time-management/tasks/extract` | 已通过检查的 `goals` | 标准化 `tasks` |
| `/api/time-management/matrix/classify` | 当前 `tasks` | `classifications`、`quadrants`、`note` |
| `/api/time-management/report/generate` | 当前 `tasks`、`matrix`、`goals` | `order`、`energyRules`、`adjustments` |

`GET /api/health` 用于健康检查。API 响应包含安全头和 `X-Request-Id`；请求日志只记录 requestId、路径、状态和耗时，不记录目标、任务或模型正文。

## 测试

全部测试使用假模型或 Playwright 路由，不需要真实 API key，也不会访问付费模型：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npm.cmd test
```

也可分阶段运行：

```powershell
npm.cmd run test:server
npm.cmd run test:e2e
```

自然语言质量仍按 `tests/prompt-cases.md` 的“人工/模型评测”流程执行，并记录模型名、日期、通过项和失败样例。

## 数据与范围边界

目标、任务、矩阵和报告只保存在浏览器当前会话的内存状态中；重新梳理或刷新页面后不会恢复。项目不建立数据库，不保存历史记录，不提供跨会话记忆。页面明确提醒不要填写客户隐私、密码或其他敏感信息。

当前版本不包含账号、权限系统、数据库、历史记录、教练助手依赖、外部平台集成或部署功能。真实模型的供应商数据用途、保留期限与删除机制需在生产接入前另行确认。

## 目录

```text
frontend/                    # 单一状态树、API 层、交互界面与安全 Markdown
server/                      # Express API、模型网关、契约与四步工作流
prompts/system.md            # 四步运行提示词
tests/server/                # Node 单元、API、安全与验收契约测试
tests/frontend.spec.js       # Playwright 端到端与响应式回归
tests/prompt-cases.md        # 自动化边界与人工/模型质量评测
docs/acceptance/             # 甲方验收清单
docs/adversarial-review.md   # 对抗审查复核
```

完整验收结论见 `docs/acceptance/time-management-v1.md`，剩余风险见 `docs/adversarial-review.md`。

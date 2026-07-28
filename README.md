# 时间管理助手（time）

面向管理者的时间管理助手。新版以参考前端为业务基准，用户登录后依次完成”事务填写 → AI 拆解确认 → 时间分布诊断 → 优先级排序 → 优化报告”；报告生成成功后会自动保存到当前账号的历史，并包含当次第三步时间分布诊断快照。

## 当前能力

- “昨天—今天—明天—后天”四栏整段输入；服务端先校验行数和输入边界，再调用模型拆成稳定 UUID 任务。
- 任务提取由模型直接返回结构化任务列表（`tasks`），一次合法输出仅调用模型一次。已完成事实不生成任务，责任人只能从原文明确责任主体提取，缺失时使用”待确认”。截止日期仅保存到日级（`YYYY-MM-DD`）。
- AI 拆解后由用户编辑任务名称、类别、截止日期、预估工时、责任人和轻重缓急；截止日期仅保存到日级（`YYYY-MM-DD`），责任人仅从原文明示内容提取，缺失时显示”待确认”。服务端执行逐字段 SMART 门禁，任务具体、工时可解析且轻重缓急完整即可继续。工作台显示只读的今日任务卡片，展示完成状态、任务名称、截止日期和责任人，不触发自动保存。
- 时间分布诊断是正式后端节点：只解析明确的小时/分钟工时，按分钟汇总四类占比，以最大余数法保证显示合计为 100.0%，并返回未参与计算的任务。
- 支持手动新增、编辑和删除任务；任务变化会使时间分布、矩阵和报告失效，必须按新数据重新计算。
- 重要/紧急矩阵只有“高”映射为“是”，任务按稳定 `taskId` 守恒，精力比例由服务端固定为 55/25/15/5。
- 优化报告同时读取当前任务、时间分布诊断和四象限结果；只按当前 `taskId` 引用任务，叙述字段通过安全 Markdown 渲染。
- 工作台、每日跟踪和历史记录复刻参考稿的信息架构；每日清单按账号和上海业务日期持久化，未勾选且未删除的任务跨日保留；工作台只读，不因 GET 自动写库；已完成报告历史继续按账号持久化。
- 用户名密码注册、登录、退出和 7 天 SQLite Session；登录成功后会换发新 Session。
- 恢复码是唯一自助找回方式，注册、重置或轮换成功后只展示一次。用户同时丢失密码和恢复码后无法自助找回账号。
- 已完成的报告以稳定 `clientRunId` 幂等保存，支持游标分页、只读详情和二次确认删除；用户数据严格隔离。
- 新写入历史（Schema 2）同时保存第三步时间分布诊断快照；历史详情按"事务填写 → 任务清单 → 时间分布诊断 → 轻重缓急矩阵 → 优化报告"顺序展示。Schema 1 旧历史详情返回 `distribution: null` 并显示"该历史版本未保存时间分布诊断"，不会触发重新计算。

`prompts/system.md` 是五步运行提示词与确定性节点说明的真源；`server/contracts/time-management.js`、各工作流的 Ajv Schema 和自动化测试共同约束运行数据。

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

`npm.cmd run dev` 通过 `scripts/start-dev.js` 启动：项目根目录存在 `.env` 时使用 Node.js 原生 `process.loadEnvFile()` 安全加载，不存在时使用调用进程已注入的环境变量。一键启动脚本继续显式加载 `.env`。变量名和假占位值见 `.env.example`：

| 变量 | 必填 | 说明 |
|---|---:|---|
| `PORT` | 否 | 本地端口，默认 `4174` |
| `MODEL_API_BASE_URL` | 是 | OpenAI 兼容接口的基础 URL，服务端会请求 `/chat/completions` |
| `MODEL_API_KEY` | 是 | 只允许注入服务端进程，不得写入前端 |
| `MODEL_NAME` | 是 | 模型名称 |
| `MODEL_TIMEOUT_MS` | 否 | 单次模型请求超时，默认 `30000` |
| `DATABASE_PATH` | 是 | SQLite 数据库路径；本地默认放在已忽略的 `data/` |
| `SESSION_SECRET` | 是 | 至少 48 字节的随机会话签名密钥，不得提交 |
| `SESSION_COOKIE_SECURE` | 是 | 当前 HTTP 部署固定为 `false` |
| `SESSION_MAX_AGE_MS` | 是 | 固定 `604800000`（7 天） |

获得真实供应商配置并确认费用与数据政策后，在当前 PowerShell 会话中安全注入这些变量，再启动：

```powershell
conda activate .\.conda
npm.cmd run dev
```

访问 `http://127.0.0.1:4174/`。不要把真实 key 写入 `.env.example`、源码、测试或文档。

应用启动时会按版本在事务中运行 migration（迁移）：migration 001 创建认证与历史表，002 大小写用户名，003 每日跟踪，004 为 `time_management_runs` 新增可空 `distribution_json TEXT`。也可在启动前显式执行：

```powershell
$env:DATABASE_PATH = '.\data\time-management.sqlite'
npm.cmd run migrate
```

本地验证一致性备份时，显式把目标放入已忽略的 `backups/`：

```powershell
$env:DATABASE_PATH = '.\data\time-management.sqlite'
npm.cmd run backup:database -- .\backups\time-management-latest.sqlite
```

备份脚本使用 SQLite Backup API，先生成同目录临时文件，通过 `PRAGMA integrity_check` 后再原子替换唯一最新备份。

### Windows 一键启动

首次使用时，在项目根目录复制配置模板：

```powershell
Copy-Item .env.example .env
```

只在本机 `.env` 中填写真实模型配置，然后双击项目根目录的 `start.bat`。脚本会使用项目专用 `.conda` 环境，通过 Node.js 原生 `--env-file=.env` 加载配置；服务健康后会自动打开浏览器。

`.env` 已加入 `.gitignore`。不要提交、分享或把 `.env` 中的 API key 复制到源码、测试及文档中。

## API

`GET /api/health` 保持公开。除预登录 CSRF 辅助接口外，时间管理与历史接口均要求已登录；所有改变状态的请求还需同源 `Origin` 和 `X-CSRF-Token`。

### 认证接口

| 方法与接口 | 用途 |
|---|---|
| `GET /api/auth/csrf` | 获取短时有效的预登录 CSRF token |
| `POST /api/auth/register` | 注册，成功时只返回一次恢复码 |
| `POST /api/auth/login` | 登录并重新生成 Session |
| `POST /api/auth/logout` | 只撤销当前 Session |
| `GET /api/auth/me` | 恢复当前登录身份和 Session CSRF token |
| `POST /api/auth/password/reset-with-recovery` | 使用恢复码重置密码，撤销该用户全部旧 Session |
| `POST /api/auth/recovery-code/rotate` | 登录后用当前密码轮换恢复码 |

### 五步业务接口

新版主流程接口均为 `POST`、`application/json`。模型节点的格式或语义错误最多自动重试一次；输入校验、SMART 和时间分布为确定性服务端节点。

| 节点与接口 | 请求核心字段 | 响应核心字段 |
|---|---|---|
| 1. `/api/time-management/intake/check` | `entries` 四栏字符串 | `lineCounts`、`warnings`、`totalLines` |
| 2. `/api/time-management/tasks/decompose` | 已校验的 `entries` | `intake`、标准化 `tasks`、初始 `smart` |
| 2. `/api/time-management/tasks/smart-check` | 用户确认后的 `tasks` | 逐任务 `results`、`overall`、`summary` |
| 3. `/api/time-management/distribution/diagnose` | SMART 通过的 `tasks` | `categories`、`percentages`、`diagnosis`、`recommendations` |
| 4. `/api/time-management/matrix/classify` | 当前 `tasks` | `classifications`、`quadrants`、`note` |
| 5. `/api/time-management/report/generate` | `tasks`、`distribution`、`matrix`、`goals` | `order`、`energyRules`、`adjustments` |

旧 `/goals/check` 和 `/tasks/extract` 仍保留为兼容接口，但新版页面不再以旧四步流程作为主路径。

### 历史接口

| 方法与接口 | 用途 |
|---|---|
| `POST /api/time-management/history` | 以 `(user_id, client_run_id)` 幂等保存已完成快照（新请求必须包含 `distribution`） |
| `GET /api/time-management/history` | 默认 20、最大 50 条的游标分页列表 |
| `GET /api/time-management/history/:id` | 读取当前用户的只读详情 |
| `DELETE /api/time-management/history/:id` | 删除当前用户指定历史 |

API 响应包含安全头和 `X-Request-Id`；请求日志只记录 requestId、路径、状态和耗时，不记录用户名、凭据、Cookie、目标或历史正文。报告格式最终失败时额外记录固定规则码和尝试次数，仍不记录用户正文、模型原文或凭据。

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

用户、密码哈希、恢复码哈希、Session 哈希和已完成历史保存在 SQLite。密码、恢复码和原始 Session ID 不明文落库；`user_id` 只来自服务端验证后的 Session。

五步未提交草稿仍只在浏览器内存；每日任务编辑、勾选和删除写入 SQLite 的账号日快照；勾选是既有任务完成状态的唯一来源。页面继续提醒不要填写客户隐私、密码或商业秘密。

当前版本不包含邮箱、SMTP、短信、社交登录、管理员后台、团队权限、草稿恢复、教练助手依赖或外部平台集成。真实模型的供应商数据用途、保留期限与删除机制需在生产接入前另行确认。

`due` 和 `owner` 作为可选兼容字段继续保存在任务和历史 JSON 中；缺失、空白或 `null` 会标准化为"待确认"；新写入的 `due` 仅接受 `YYYY-MM-DD` 或"待确认"，`owner` 仅从原文明示内容提取。本次无需数据库迁移。

## 目录

```text
frontend/                         # 参考稿视觉、五步状态树、每日跟踪、历史与安全 Markdown
server/                           # Express、认证/历史、SQLite、模型网关与五步工作流
scripts/start-dev.js              # 可选加载本地 .env 的开发启动器
scripts/                          # migration 与 SQLite 一致性备份 CLI
prompts/system.md                 # 五步提示词与确定性诊断说明
tests/server/                     # Node 单元、API、安全与验收契约测试
tests/reference-auth-history.spec.js # 新版认证、历史、退出与移动端回归
tests/reference-five-step.spec.js    # 新版五步、导航与响应式回归
tests/frontend.spec.js           # 旧四步界面历史回归资料，不在当前 Playwright testMatch 中
tests/auth-history.spec.js       # 旧四步账号界面历史回归资料，不在当前 Playwright testMatch 中
tests/prompt-cases.md        # 自动化边界与人工/模型质量评测
docs/acceptance/             # 甲方验收清单
docs/adversarial-review.md   # 对抗审查复核
```

新版五步与参考界面验收见 `docs/acceptance/reference-five-step-v2.md`；旧四步业务验收和账号历史验收仍分别保存在 `docs/acceptance/time-management-v1.md`、`docs/acceptance/account-auth-history-v1.md`，剩余风险见 `docs/adversarial-review.md`。

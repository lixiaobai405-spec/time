# 时间管理助手（time）

面向管理者的时间管理助手。用户使用用户名和密码登录后，依次完成“目标梳理 → 任务提取 → 矩阵判定 → 优先级报告”；报告生成成功后会自动保存到当前账号的历史。

## 当前能力

- “昨天—今天—明天—后天”四栏目标输入，按 PDCA 和 SMART 返回字段级 `issue`、`suggestion` 与“采纳建议”。
- `overall=need_fix` 时阻止任务提取；修改目标后必须重新检查。
- AI 提取任务并生成稳定 UUID；未提供截止时间统一显示“待确认”。
- 支持手动新增和删除任务。手动任务可以不标注重要性/紧急度，保存为 `null/null`，矩阵判定后显示“AI 判定”。
- 重要/紧急矩阵只有“高”映射为“是”，精力比例由服务端固定为 55/25/15/5。
- 报告只按当前 `taskId` 引用任务，叙述字段通过安全 Markdown 渲染，可复制当前页面报告。
- 用户名密码注册、登录、退出和 7 天 SQLite Session；登录成功后会换发新 Session。
- 恢复码是唯一自助找回方式，注册、重置或轮换成功后只展示一次。用户同时丢失密码和恢复码后无法自助找回账号。
- 已完成的报告以稳定 `clientRunId` 幂等保存，支持游标分页、只读详情和二次确认删除；用户数据严格隔离。

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

服务端直接读取进程环境变量；直接运行 `npm.cmd run dev` 时不会自动加载 `.env`，一键启动脚本则使用 Node.js 20 原生参数安全加载。变量名和假占位值见 `.env.example`：

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

应用启动时会按版本在事务中运行 migration（迁移）；也可在启动前显式执行：

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

### 四步业务接口

四个接口均为 `POST`、`application/json`，模型格式或语义错误最多自动重试一次。

| 接口 | 请求核心字段 | 响应核心字段 |
|---|---|---|
| `/api/time-management/goals/check` | `goals` 四栏字符串 | `fields`、`overall` |
| `/api/time-management/tasks/extract` | 已通过检查的 `goals` | 标准化 `tasks` |
| `/api/time-management/matrix/classify` | 当前 `tasks` | `classifications`、`quadrants`、`note` |
| `/api/time-management/report/generate` | 当前 `tasks`、`matrix`、`goals` | `order`、`energyRules`、`adjustments` |

### 历史接口

| 方法与接口 | 用途 |
|---|---|
| `POST /api/time-management/history` | 以 `(user_id, client_run_id)` 幂等保存已完成快照 |
| `GET /api/time-management/history` | 默认 20、最大 50 条的游标分页列表 |
| `GET /api/time-management/history/:id` | 读取当前用户的只读详情 |
| `DELETE /api/time-management/history/:id` | 删除当前用户指定历史 |

API 响应包含安全头和 `X-Request-Id`；请求日志只记录 requestId、路径、状态和耗时，不记录用户名、凭据、Cookie、目标或历史正文。

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

当前四步草稿仍只存在浏览器内存：草稿不会保存，刷新页面不会恢复；只有成功生成的报告会进入账号历史。页面继续提醒不要填写客户隐私、密码或商业秘密。

当前版本不包含邮箱、SMTP、短信、社交登录、管理员后台、团队权限、草稿恢复、教练助手依赖或外部平台集成。真实模型的供应商数据用途、保留期限与删除机制需在生产接入前另行确认。

## 目录

```text
frontend/                    # 单一状态树、API 层、交互界面与安全 Markdown
server/                      # Express、认证/历史路由、SQLite、模型网关与四步工作流
scripts/                     # migration 与 SQLite 一致性备份 CLI
prompts/system.md            # 四步运行提示词
tests/server/                # Node 单元、API、安全与验收契约测试
tests/auth-history.spec.js   # 认证、历史与用户隔离 Playwright 回归
tests/frontend.spec.js       # 四步工作流与响应式 Playwright 回归
tests/prompt-cases.md        # 自动化边界与人工/模型质量评测
docs/acceptance/             # 甲方验收清单
docs/adversarial-review.md   # 对抗审查复核
```

四步业务验收见 `docs/acceptance/time-management-v1.md`，账号与历史验收见 `docs/acceptance/account-auth-history-v1.md`，剩余风险见 `docs/adversarial-review.md`。

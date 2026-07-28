# Task Spec

## 1. Task Title

替换第一步骤“事务填写”四个输入框的分类提示语。

## 2. Goal

用户进入第一步骤“事务填写”后，“昨天 / 遗留问题”“今天 / 日事日毕”“明天 / 能力提升”“后天 / 未来规划”四个文本框分别显示甲方指定的分类填写引导，使用户在输入前能理解每一栏应记录的时间范围和事项类型；用户实际输入、四栏提交和后续五步流程行为保持不变。

## 3. Project Context

### 已确认的当前事实

- 当前第一步骤由 `frontend/app.js` 的 `stepOneBody()` 渲染。
- `stepOneBody()` 遍历 `CATEGORY_KEYS` 生成四个 `textarea`，元素 ID 分别为 `entry-昨天`、`entry-今天`、`entry-明天`、`entry-后天`。
- 四个 `textarea` 当前共用同一句 `placeholder`：“每行写一件事，可顺带写明日期、耗时和轻重缓急”。
- `frontend/app.js` 中的 `CATS` 已将四栏映射为：
  - `昨天`：遗留问题；
  - `今天`：日事日毕；
  - `明天`：能力提升；
  - `后天`：未来规划。
- 输入内容保存在 `state.entries`，提交到 `POST /api/time-management/intake/check`；`server/workflows/check-intake.js` 只校验真实输入内容，不读取浏览器 `placeholder`。
- `tests/reference-five-step.spec.js` 是当前 Playwright 五步流程回归文件，已有第一步骤填值、提交和 375px 窄屏检查，但尚未断言四个提示语。
- `playwright.config.js` 的当前 `testMatch` 包含 `tests/reference-five-step.spec.js` 和 `tests/reference-auth-history.spec.js`，测试使用假模型配置，不需要真实 API key。
- 用户提供的截图显示目标位置是第一步骤四张分类卡片内的四个大文本框。

### 用户明确要求

- 将四个填写框的提示语分别替换为：
  - `昨天`：“记录尚未完成或被拖延的事项，例如未解决问题、延期任务、临时救火事项；”
  - `今天`：“记录今天计划完成的主要工作事项，请填写具体任务；”
  - `明天`：“记录未来1-4周需要投入时间建设和改善的事项，例如流程优化、机制建设、团队培养、能力提升；”
  - `后天`：“记录未来规划和提前布局事项，例如战略思考、重要项目准备、能力储备。”

### planner 作出的假设

- 甲方原文中的“1、2、3、4、”是需求清单序号，不属于输入框内显示的提示语。
- 第一条末尾的“；，”是重复标点，任务按“；”实现；其余文案、数字和标点保持上述文本，不擅自润色。
- “填写框内提示语”指 HTML `placeholder`，不是卡片标题、卡片说明、默认输入值或输入框外新增的帮助文本。

### 尚未验证的信息

- 长提示语在不同 Windows 字体缩放比例下的可见行数尚未实测；executor 需至少验证项目现有桌面视口和 375px 窄屏。

## 4. Scope

- 在第一步骤“事务填写”中，为 `entry-昨天`、`entry-今天`、`entry-明天`、`entry-后天` 设置各自独立的 `placeholder`，内容严格采用第 3 节列出的四条文案。
- 保持四栏与 `CATEGORY_KEYS` 的既有顺序及分类映射不变。
- 保持文本框的 ID、`data-entry`、用户输入值、输入事件、提交 payload 和空栏警告行为不变。
- 在 `tests/reference-five-step.spec.js` 增加 Playwright 回归，逐一断言四个文本框的 `placeholder` 精确值。
- 回归验证输入后实际 `value` 是用户填写内容，提示语不会进入 `state.entries` 或 `POST /api/time-management/intake/check` payload。
- 在桌面端和 375px 窄屏检查第一步骤无整页横向溢出、四个文本框仍可见可输入，且没有 `console error` 或 `pageerror`。
- 不涉及历史数据、提示词、数据库或部署文档。

## 5. Non-Scope

- 不修改四张卡片的标题、简称、说明文字、目标占比、颜色或布局。
- 不修改第一步骤之外的页面、导航、AI 拆解确认、时间分布、矩阵、报告、每日跟踪、历史或认证功能。
- 不修改 `POST /api/time-management/intake/check` 的请求或响应 schema、空栏规则、最大条目数或错误码。
- 不修改 `prompts/system.md`、`server/prompts/load-step-prompt.js` 或任何模型 JSON 契约。
- 不修改 SQLite schema，不执行 migration，不转换历史数据。
- 不引入或升级依赖，不做无关重构。
- 不修改 `.env`、`.gitignore` 或生产部署配置，不执行生产部署。
- 不处理 `D:\codex-pj\teacher` 教练助手项目。
- 不覆盖、回滚、整理或提交当前工作区已有的截止日期兼容改造及其他未提交成果。

## 6. Constraints

- 沿用现有原生 HTML、CSS、JavaScript、CommonJS、Node Test Runner 和 Playwright 技术栈及代码风格。
- 采用最小必要改动；优先只修改 `frontend/app.js` 和 `tests/reference-five-step.spec.js`。
- 不读取或修改 `.env`，不在代码、测试、日志或文档中写入真实 API key、Cookie、密码、恢复码或 Session。
- 当前 `frontend/app.js`、`frontend/index.html`、`tests/reference-five-step.spec.js` 等文件已有未提交修改；executor 必须在现有内容之上做局部编辑，不得覆盖、回滚或用旧版本替换文件。
- 不处理与本任务无关的 `tests/manual-test-input-template.md` 或其他 untracked 文件。
- 不新增依赖，除非用户另行明确批准。
- 本任务不需要数据库变化；若执行中发现必须改变数据库，立即停止并另行提出 migration、备份和回退方案，不得自行扩展。
- 所有 Node 和 npm 命令使用项目 `.conda` 中的 Node.js 20.20.2 与 npm 10.8.2，不使用未经确认的全局 Node。
- executor 不得自行 commit 或 push，除非用户另行授权。

## 7. Related Files

- `frontend/app.js`：已确认 `CATS` 四栏映射和 `stepOneBody()`；当前四个 `textarea` 在此共用同一句 `placeholder`，是本任务的最小实现位置。该文件已有截止日期相关未提交修改，必须局部合并。
- `tests/reference-five-step.spec.js`：已确认包含第一步骤填写、完整五步流程和 375px 窄屏 Playwright 回归；应在此新增提示语精确断言和输入 payload 不受影响的回归。该文件已有截止日期相关未提交修改，必须保留。
- `frontend/index.html`：已确认包含 `textarea`、四栏桌面布局和响应式样式；本任务默认只用于核对长提示语的显示与窄屏溢出，不应修改，除非新增测试证明现有样式无法满足验收。
- `server/workflows/check-intake.js`：已确认服务端校验 `entries` 的真实字符串、空栏和条目数，不读取 `placeholder`；本任务只用于确认后端行为无需修改。
- `playwright.config.js`：已确认当前 Playwright 测试范围、测试服务和假模型环境；本任务无需修改。
- `package.json`：已确认 `test:server`、`test:e2e` 和 `test` 命令；本任务无需修改。

## 8. Implementation Plan

1. 在 `D:\codex-pj\time` 执行 `git status --short --branch`、`git diff --stat` 和 `git diff`，再次确认 `frontend/app.js` 与 `tests/reference-five-step.spec.js` 的既有未提交内容；只在目标行附近编辑，不替换整文件。
2. 在 `tests/reference-five-step.spec.js` 新增独立测试“第一步骤四栏显示甲方指定提示语且不进入提交内容”：
   - 打开 `/` 并点击“开始梳理”；
   - 用 `#entry-昨天`、`#entry-今天`、`#entry-明天`、`#entry-后天` 精确定位四个文本框；
   - 使用 `toHaveAttribute('placeholder', expectedText)` 分别断言第 3 节四条目标文案；
   - 监听或拦截 `POST /api/time-management/intake/check`，向四栏填写测试内容后提交，断言 payload 仅包含测试输入，不包含任何提示语。
3. 设置 `PLAYWRIGHT_BROWSERS_PATH=0`，仅运行第 2 步新增测试；确认它因当前四栏仍共用旧提示语而失败，失败信息应指向 `placeholder` 期望值差异，而不是登录、网络、测试数据或既有未提交改造错误。若测试在实现前意外通过，停止并核对当前代码与测试定位，不能跳过 Red 阶段。
4. 在 `frontend/app.js` 为四个分类定义明确的提示语映射，并让 `stepOneBody()` 根据当前 `key` 输出相应 `placeholder`；不得改变 `id="entry-${key}"`、`data-entry="${key}"`、`state.entries[key]` 或事件处理。
5. 重新运行第 2 步的定向 Playwright 测试，要求四条精确文案和 payload 隔离断言全部通过。
6. 扩展或复用 `tests/reference-five-step.spec.js` 的 375px 测试：
   - 在 375×812 视口进入第一步骤；
   - 确认四个文本框可见且可输入；
   - 确认 `document.documentElement.scrollWidth <= clientWidth + 1`；
   - 收集 `console` 的 error 消息和 `pageerror`，要求均为空。
7. 运行 `tests/reference-five-step.spec.js` 全文件回归，确认第一步骤提交、五步流程、截止日期兼容改造相关断言和窄屏回归均通过。
8. 运行服务端回归、完整 Playwright 回归和项目完整测试；测试必须继续使用假模型，不得连接真实付费模型。
9. 执行 `git diff --check`、`git status --short --branch`、`git diff --stat` 和 `git diff`；确认本任务只为目标提示语及其测试增加必要差异，既有未提交修改仍被保留，且没有 `.env`、依赖、提示词、数据库或部署变更。
10. 输出已修改文件、Red/Green 测试证据、完整回归结果和仍未验证事项，等待 reviewer 验收；不要 commit 或 push。

## 9. Risks and Notes

- `frontend/app.js` 和 `tests/reference-five-step.spec.js` 已存在用户或其他 executor 的未提交截止日期兼容改造，是本任务的直接重叠文件；最大风险是整文件替换或基于 `HEAD` 重做导致这些成果丢失。必须采用局部编辑并在完成后逐段检查 diff。
- 四条文案与四栏的映射若只依赖数组位置，后续调整 `CATEGORY_KEYS` 顺序时可能错位；实现应按 `昨天 / 今天 / 明天 / 后天` 的 key 显式映射。
- 长提示语可能在文本框内换行或在浏览器原生 placeholder 渲染中只显示部分内容；这不应通过缩小字体或扩大页面宽度解决。验收重点是属性值精确、文本框可用和页面无横向溢出。
- `placeholder` 仅在输入为空时显示，不能作为默认 `value`；若误写入 `state.entries`，会污染 API payload、AI 拆解和历史内容。
- 本任务不触碰模型 JSON 契约，因此不应新增 `MODEL_OUTPUT_INVALID` 风险，也不得借机修改提示词或重试行为。
- 本任务不改变 API、SQLite、每日跟踪、Session、CSRF、账号隔离、Nginx 或服务器版本。

## 10. Acceptance Criteria

- [ ] `#entry-昨天` 的 `placeholder` 精确为“记录尚未完成或被拖延的事项，例如未解决问题、延期任务、临时救火事项；”。
- [ ] `#entry-今天` 的 `placeholder` 精确为“记录今天计划完成的主要工作事项，请填写具体任务；”。
- [ ] `#entry-明天` 的 `placeholder` 精确为“记录未来1-4周需要投入时间建设和改善的事项，例如流程优化、机制建设、团队培养、能力提升；”。
- [ ] `#entry-后天` 的 `placeholder` 精确为“记录未来规划和提前布局事项，例如战略思考、重要项目准备、能力储备。”。
- [ ] 四个输入框内不显示需求清单序号“1、2、3、4、”，第一条不包含重复标点“；，”。
- [ ] 四个文本框的 ID、`data-entry`、已有输入值绑定和分类顺序保持不变。
- [ ] 用户向四栏输入内容后，文本框 `value` 等于用户输入；发送到 `/api/time-management/intake/check` 的 `entries` 不包含任何提示语。
- [ ] 原有空栏警告、至少填写一项的校验和后续 AI 拆解入口未退化。
- [ ] 桌面端第一步骤四个输入框可见、可输入，长提示语不引起卡片或整页横向溢出。
- [ ] 375×812 视口无整页横向溢出，四个输入框仍可见、可输入。
- [ ] 目标页面操作过程中没有未预期的 `console error` 或 `pageerror`。
- [ ] 不修改服务端 API、提示词、数据库、历史数据、每日跟踪、认证、依赖或部署配置。
- [ ] 当前截止日期兼容改造及其他已有未提交修改未被覆盖、回滚或混入无关处理。

## 11. Verification

所有命令均在 PowerShell 7 和 `D:\codex-pj\time` 中执行。

1. 确认项目专用运行时：

   ```powershell
   .\.conda\node.exe --version
   .\.conda\npm.cmd --version
   ```

   两条命令预期退出码均为 `0`；输出应分别为 `v20.20.2` 和 `10.8.2`。若版本不符，停止并报告，不切换到全局 Node。

2. TDD Red/Green 定向验证：

   ```powershell
   $env:PLAYWRIGHT_BROWSERS_PATH = '0'
   .\.conda\npm.cmd run test:e2e -- --grep "第一步骤四栏显示甲方指定提示语且不进入提交内容"
   ```

   写测试后、实现前预期退出码非 `0`，且失败原因只能是四个 `placeholder` 仍为旧文案；实现后预期退出码为 `0`，命中的测试全部通过。

3. 第一阶段前端文件回归：

   ```powershell
   $env:PLAYWRIGHT_BROWSERS_PATH = '0'
   .\.conda\npm.cmd run test:e2e -- tests/reference-five-step.spec.js
   ```

   预期退出码为 `0`；该文件全部测试通过，包括提示语、payload、完整五步和 375px 窄屏回归。

4. 服务端回归：

   ```powershell
   .\.conda\npm.cmd run test:server
   ```

   预期退出码为 `0`；Node Test Runner 报告无失败、取消或未预期跳过。虽然本任务不改服务端，该结果用于证明前端文案改动未伴随服务端回归。

5. 完整 Playwright 回归：

   ```powershell
   $env:PLAYWRIGHT_BROWSERS_PATH = '0'
   .\.conda\npm.cmd run test:e2e
   ```

   预期退出码为 `0`；`reference-five-step.spec.js` 与 `reference-auth-history.spec.js` 全部通过，无未预期 `console error`、`pageerror` 或横向溢出。

6. 项目完整回归：

   ```powershell
   $env:PLAYWRIGHT_BROWSERS_PATH = '0'
   .\.conda\npm.cmd test
   ```

   预期退出码为 `0`；服务端和 E2E 阶段均通过。

7. 差异和工作区检查：

   ```powershell
   git diff --check
   git status --short --branch
   git diff --stat
   git diff
   ```

   所有 Git 命令预期退出码为 `0`。`git diff --check` 不得报告空白错误；其余输出必须显示目标文案与测试的最小新增差异，并保留任务开始前已经存在的未提交修改。

若任一验证因本机浏览器、端口占用或环境问题无法执行，executor 必须报告具体命令、退出码和原始错误摘要，不得把“未执行”写成“通过”。测试只能使用仓库既有假模型和占位凭据，不得读取真实 `.env`、使用真实 API key 或调用付费模型。

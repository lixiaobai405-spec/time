const { test, expect } = require('@playwright/test');

const TASKS = [
  {
    id: 'task-y', name: '补交上周未完成的月报', source: '复盘', due: '2026-07-22 18:00', est: '1h',
    importance: '高', urgency: '高', owner: '待确认', acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'task-t', name: '完成今天的方案终稿校对', source: '今天', due: '2026-07-22', est: '7h',
    importance: '高', urgency: '高', owner: '待确认', acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'task-m', name: '梳理内容审核流程规范', source: '短期目标', due: '2026-07-26', est: '1.5h',
    importance: '高', urgency: '低', owner: '待确认', acceptanceCriteria: ['形成可评审的流程文档'], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'task-f', name: '制定团队能力建设季度规划', source: '中长期', due: '2026-09-30', est: '30分钟',
    importance: '高', urgency: '低', owner: '待确认', acceptanceCriteria: ['形成三个里程碑'], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
];

function matrixPayload() {
  return {
    classifications: TASKS.map(task => ({
      taskId: task.id,
      importance: task.importance,
      urgency: task.urgency,
      classificationSource: task.classificationSource,
    })),
    quadrants: [
      { name: '第一象限', priority: 1, action: '立即做', energyPercent: 55, taskIds: ['task-y', 'task-t'] },
      { name: '第二象限', priority: 2, action: '计划做', energyPercent: 25, taskIds: ['task-m', 'task-f'] },
      { name: '第三象限', priority: 3, action: '授权做', energyPercent: 15, taskIds: [] },
      { name: '第四象限', priority: 4, action: '减少做', energyPercent: 5, taskIds: [] },
    ],
    note: '',
  };
}

async function installMocks(page) {
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'user-1', username: '测试用户' }, csrfToken: 'csrf' }),
  }));
  await page.route('**/api/time-management/intake/check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'pass', entries: route.request().postDataJSON().entries,
      lineCounts: { 昨天: 1, 今天: 1, 明天: 1, 后天: 1 }, totalLines: 4, warnings: [],
    }),
  }));
  await page.route('**/api/time-management/tasks/decompose', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      intake: { lineCounts: { 昨天: 1, 今天: 1, 明天: 1, 后天: 1 }, totalLines: 4, warnings: [] },
      tasks: TASKS,
      smart: { overall: 'pass', results: TASKS.map(task => ({ taskId: task.id, status: 'pass', issues: [] })), summary: { total: 4, pass: 4, needFix: 0 } },
    }),
  }));
  await page.route('**/api/time-management/tasks/smart-check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ overall: 'pass', results: TASKS.map(task => ({ taskId: task.id, status: 'pass', issues: [] })), summary: { total: 4, pass: 4, needFix: 0 } }),
  }));
  await page.route('**/api/time-management/distribution/diagnose', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      totalMinutes: 600, totalHours: 10, validTaskCount: 4, invalidTasks: [],
      percentages: { 昨天: 10, 今天: 70, 明天: 15, 后天: 5 },
      categories: [
        { key: '昨天', minutes: 60, hours: 1, percent: 10, target: { min: 0, max: 2, label: '→0%' }, status: 'over' },
        { key: '今天', minutes: 420, hours: 7, percent: 70, target: { min: 70, max: 80, label: '70–80%' }, status: 'ok' },
        { key: '明天', minutes: 90, hours: 1.5, percent: 15, target: { min: 10, max: 20, label: '10–20%' }, status: 'ok' },
        { key: '后天', minutes: 30, hours: 0.5, percent: 5, target: { min: 3, max: 100, label: '5%' }, status: 'ok' },
      ],
      diagnosis: ['“昨天”遗留偏高。', '其余三类达到目标。'],
      recommendations: ['集中清理遗留事项。', '保护机制建设时段。'],
    }),
  }));
  await page.route('**/api/time-management/matrix/classify', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(matrixPayload()),
  }));
  await page.route('**/api/time-management/report/generate', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      order: [
        { taskId: 'task-y', reason: '先清零遗留，避免继续滚存。' },
        { taskId: 'task-t', reason: '今天到期且直接影响交付。' },
        { taskId: 'task-m', reason: '保护第二象限机制建设。' },
      ],
      energyRules: ['先完成第一象限，再保护第二象限整块时间。', '合并低价值零散事务。'],
      adjustments: ['今天清理遗留事项。', '每周固定复盘团队能力建设里程碑。'],
    }),
  }));
  await page.route('**/api/time-management/history', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'history-1', ...body, schemaVersion: 2, createdAt: '2026-07-22T12:00:00.000Z', updatedAt: '2026-07-22T12:00:00.000Z' }),
    });
  });
  await page.route('**/api/time-management/daily-tracking/today', async route => {
    const request = route.request();
    const body = request.method() === 'PUT' ? request.postDataJSON() : null;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: body?.tasks || TASKS,
        tracking: body?.tracking || {},
        removedTaskIds: body?.removedTaskIds || [],
        revision: request.method() === 'PUT' ? 1 : 0,
        updatedAt: request.method() === 'PUT' ? '2026-07-23T02:00:00.000Z' : null,
        sourceSummary: { historyCount: 1, taskCount: (body?.tasks || TASKS).length },
        hasUnpersistedMerge: false,
      }),
    });
  });
}

async function openAiConfirmation(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#entry-昨天').fill('补交上周未完成的月报');
  await page.locator('#entry-今天').fill('完成今天的方案终稿校对');
  await page.locator('#entry-明天').fill('梳理内容审核流程规范');
  await page.locator('#entry-后天').fill('制定团队能力建设季度规划');
  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('AI 拆解确认');
}

async function expectNoPageOverflow(page) {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}

async function completeFiveSteps(page) {
  await openAiConfirmation(page);
  await page.getByRole('button', { name: 'SMART 校验' }).click();
  await expect(page.locator('#panel').getByText('全部任务通过 SMART 校验')).toBeVisible();
  await page.getByRole('button', { name: /时间分布诊断/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('时间分布诊断');
  await page.getByRole('button', { name: /优先级排序/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级排序');
  await page.getByRole('button', { name: /生成优化报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('时间投入优化报告');
}

test.beforeEach(async ({ page }) => {
  await installMocks(page);
});

test('零任务返回错误提示且可返回修改原文', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.route('**/api/time-management/tasks/decompose', route => route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'NO_ACTIONABLE_TASKS', message: '没有识别出可执行任务，请调整四栏内容后重试。' },
    }),
  }));

  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#entry-昨天').fill('补交上周未完成的月报');
  await page.locator('#entry-今天').fill('完成新功能联调');
  await page.locator('#entry-明天').fill('本月底前整理团队规范');
  await page.locator('#entry-后天').fill('年底完成年度规划');
  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();
  await expect(page.locator('#toast.on')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#toast')).toContainText('没有识别出可执行任务');

  // 停留在第一步，仍可修改原文
  await expect(page.locator('#entry-昨天')).toBeVisible();
  await page.locator('#entry-昨天').fill('修改后的季度复盘说明');
  await expect(page.locator('#entry-昨天')).toHaveValue('修改后的季度复盘说明');
  // 422 被浏览器记录为 console error，属于预期行为
});

test('任务拆解后可直接编辑任务名称', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await openAiConfirmation(page);

  // 没有 warning 区块
  await expect(page.locator('.task-warning-list')).toHaveCount(0);
  const taskName = page.locator('[data-task-row="task-y"] [data-task-field="name"]');
  await taskName.fill('编辑后的已验证任务');
  await expect(taskName).toHaveValue('编辑后的已验证任务');
  await expect(page.locator('[data-task-row]')).toHaveCount(TASKS.length);
  expect(browserErrors).toEqual([]);
});

test('AI 拆解确认和手动新增展示并提交日期责任人', async ({ page }) => {
  let smartPayload = null;
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/tasks/smart-check')) {
      smartPayload = request.postDataJSON();
    }
  });

  await openAiConfirmation(page);

  await expect(page.locator('.trow.hd.g-edit')).toContainText('截止日期');
  await expect(page.locator('.trow.hd.g-edit')).toContainText('责任人');
  await expect(page.locator('.trow.hd.g-edit')).toContainText('预估时长（小时）');
  await expect(page.locator('[data-task-row="task-y"] [data-task-field="est"]'))
    .toHaveAttribute('aria-label', '预估时长（小时）');

  await page.getByRole('button', { name: '+ 手动添加任务' }).click();
  await expect(page.locator('#m-due')).toHaveCount(1);
  await expect(page.locator('#m-owner')).toHaveCount(1);
  await page.locator('#m-name').fill('整理补充验收清单');
  await page.locator('#m-due').fill('2026-08-15');
  await page.locator('#m-owner').fill('李四');
  await page.locator('#m-est').fill('1');
  await page.locator('#m-priority').selectOption('IU');
  await page.locator('#m-category').selectOption('今天');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '+ 手动添加任务' }).click();
  await page.locator('#m-name').fill('整理空值验收清单');
  await page.locator('#m-est').fill('0.5');
  await page.locator('#m-priority').selectOption('IU');
  await page.locator('#m-category').selectOption('今天');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: 'SMART 校验' }).click();
  await expect.poll(() => smartPayload).not.toBeNull();

  expect(smartPayload.tasks.find(task => task.id === 'task-y').due)
    .toBe('2026-07-22');
  expect(smartPayload.tasks.find(task => task.name === '整理补充验收清单'))
    .toMatchObject({
      due: '2026-08-15',
      owner: '李四',
    });
  expect(smartPayload.tasks.find(task => task.name === '整理空值验收清单'))
    .toMatchObject({
      due: '待确认',
      owner: '待确认',
    });
  expect(smartPayload.tasks.find(task => task.id === 'task-y').owner)
    .toBe('待确认');
  expect(browserErrors).toEqual([]);
});

test('第一步骤四栏显示甲方指定提示语且不进入提交内容', async ({ page }) => {
  let intakePayload = null;
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/intake/check')) {
      intakePayload = request.postDataJSON();
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();

  await expect(page.locator('#entry-昨天'))
    .toHaveAttribute('placeholder', '记录尚未完成或被拖延的事项，例如未解决问题、延期任务、临时救火事项；');
  await expect(page.locator('#entry-今天'))
    .toHaveAttribute('placeholder', '记录今天计划完成的主要工作事项，请填写具体任务；');
  await expect(page.locator('#entry-明天'))
    .toHaveAttribute('placeholder', '记录未来1-4周需要投入时间建设和改善的事项，例如流程优化、机制建设、团队培养、能力提升；');
  await expect(page.locator('#entry-后天'))
    .toHaveAttribute('placeholder', '记录未来规划和提前布局事项，例如战略思考、重要项目准备、能力储备。');

  await page.locator('#entry-昨天').fill('测试昨天事项');
  await page.locator('#entry-今天').fill('测试今天事项');
  await page.locator('#entry-明天').fill('测试明天事项');
  await page.locator('#entry-后天').fill('测试后天事项');

  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();

  expect(intakePayload.entries.昨天).toBe('测试昨天事项');
  expect(intakePayload.entries.今天).toBe('测试今天事项');
  expect(intakePayload.entries.明天).toBe('测试明天事项');
  expect(intakePayload.entries.后天).toBe('测试后天事项');
  for (const value of Object.values(intakePayload.entries)) {
    expect(value).not.toContain('记录尚未完成');
    expect(value).not.toContain('记录今天计划');
    expect(value).not.toContain('1-4周');
    expect(value).not.toContain('战略思考');
  }
  expect(browserErrors).toEqual([]);
});

test('新版参考界面完整贯穿五步后端流程', async ({ page }) => {
  await completeFiveSteps(page);
  await expect(page.locator('.step')).toHaveCount(5);
  await expect(page.getByText('今日执行顺序')).toBeVisible();
  await expect(page.getByText('时间投入优化目标')).toBeVisible();
  await expect(page.getByRole('heading', { name: '改变与举措', exact: true })).toBeVisible();
  await expect(page.getByText('历史已保存。')).toBeVisible();
});

test('历史保存包含当次 distribution 且不泄露内部字段', async ({ page }) => {
  let historyPayload = null;
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/history') && request.method() === 'POST') {
      historyPayload = request.postDataJSON();
    }
  });

  await completeFiveSteps(page);
  await expect(page.getByText('历史已保存。')).toBeVisible();

  // Wait for the history POST to have been captured
  await expect.poll(() => historyPayload).not.toBeNull();
  expect(historyPayload.distribution).toBeDefined();
  expect(historyPayload.distribution.totalMinutes).toBe(600);
  expect(historyPayload.distribution.categories).toHaveLength(4);
  expect(historyPayload.distribution.percentages).toEqual({ 昨天: 10, 今天: 70, 明天: 15, 后天: 5 });

  // distribution must not contain model output, prompts, or credentials
  const serialized = JSON.stringify(historyPayload.distribution);
  expect(serialized).not.toContain('"prompt"');
  expect(serialized).not.toContain('"model"');
  expect(serialized).not.toContain('api_key');
  expect(serialized).not.toContain('sk-');
});

test('公网 HTTP 无 Clipboard API 时使用兼容方式复制报告', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = command => {
      if (command !== 'copy') return false;
      const input = document.activeElement;
      window.__fallbackCopiedText = input?.value?.slice(input.selectionStart, input.selectionEnd) || '';
      return true;
    };
  });

  await completeFiveSteps(page);
  await page.getByRole('button', { name: '复制报告' }).click();

  await expect(page.locator('#toast')).toHaveText('已复制报告');
  const copiedText = await page.evaluate(() => window.__fallbackCopiedText);
  expect(copiedText).toContain('今日执行顺序');
  expect(copiedText).toContain('时间投入优化目标');
  await expect(page.locator('[data-copy-fallback]')).toHaveCount(0);
});

test('工作台与历史只读展示日期责任人且每日跟踪保持可编辑', async ({ page }) => {
  await completeFiveSteps(page);

  await page.locator('.step').filter({ hasText: '优先级排序' }).click();
  await expect(page.locator('.qt').filter({ hasText: '截止' })).toHaveCount(0);

  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expect(page.locator('[data-daily-task-field="due"]')).toHaveCount(4);
  await expect(page.locator('.g-daily')).toHaveCount(5);

  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('工作台');
  await expect(page.locator('.hcard')).toHaveCount(4);
});

test('AI 拆解确认和手动新增可编辑日期与责任人并提交日级 due', async ({ page }) => {
  let smartPayload = null;

  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/tasks/smart-check')) {
      smartPayload = request.postDataJSON();
    }
  });

  await openAiConfirmation(page);

  const row = page.locator('[data-task-row="task-y"]');
  await row.locator('[data-task-field="due"]').fill('2026-08-01');
  await row.locator('[data-task-field="owner"]').fill('王五');

  await page.locator('[data-task-field="due"]').first().evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await page.locator('[data-task-field="owner"]').first().evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));

  await page.getByRole('button', { name: 'SMART 校验' }).click();
  await expect.poll(() => smartPayload).not.toBeNull();

  expect(smartPayload.tasks.find(task => task.id === 'task-y')).toMatchObject({
    due: '2026-08-01',
    owner: '王五',
  });
});

test('375px 窄屏无整页横向溢出', async ({ page }) => {
  async function expectNoPageOverflow() {
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  }
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await expectNoPageOverflow();
  await expect(page.locator('.cols4')).toBeVisible();

  // AI confirmation screen
  await page.locator('#entry-昨天').fill('测试遗留');
  await page.locator('#entry-今天').fill('测试今天');
  await page.locator('#entry-明天').fill('测试明天');
  await page.locator('#entry-后天').fill('测试后天');
  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('AI 拆解确认');
  await expectNoPageOverflow();

  // Manual add modal
  await page.getByRole('button', { name: '+ 手动添加任务' }).click();
  await expect(page.locator('#m-name')).toBeVisible();
  await expectNoPageOverflow();
  await page.keyboard.press('Escape');

  // Daily tracking
  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expectNoPageOverflow();

  // Workbench card
  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('工作台');
  await expect(page.locator('.home-daily-card')).toBeVisible();
  await expectNoPageOverflow();

  expect(consoleErrors).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('1440x900 desktop date owner layouts are readable', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openAiConfirmation(page);

  await expectNoPageOverflow(page);
  await expect(page.locator('[data-task-field="due"]').first()).toHaveValue('2026-07-22');
  const aiDueBox = await page.locator('[data-task-field="due"]').first().boundingBox();
  expect(aiDueBox.width).toBeGreaterThanOrEqual(100);

  await page.getByRole('button', { name: '+ 手动添加任务' }).click();
  await expect(page.locator('#m-due')).toBeVisible();
  await expect(page.locator('#m-owner')).toBeVisible();
  await expectNoPageOverflow(page);
  await page.keyboard.press('Escape');

  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('[data-daily-task-field="due"]').first()).toBeVisible();
  await expect(page.locator('[data-daily-task-field="due"]').first()).toHaveValue('2026-07-22');
  await expect(page.locator('[data-daily-task-field="owner"]').first()).toBeVisible();
  await expectNoPageOverflow(page);

  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.home-daily-card')).toBeVisible();
  await page.getByRole('button', { name: '展开今日任务列表' }).click();
  await expect(page.locator('.home-daily-card')).toContainText('2026-07-22');
  await expectNoPageOverflow(page);

  const avatarMetrics = await page.locator('.avatar').evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineTops = new Set(
      [...range.getClientRects()].map(rect => Math.round(rect.top)),
    );
    return {
      width: box.width,
      height: box.height,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      lineCount: lineTops.size,
      whiteSpace: getComputedStyle(element).whiteSpace,
    };
  });
  expect(avatarMetrics.width).toBeCloseTo(32, 0);
  expect(avatarMetrics.height).toBeCloseTo(32, 0);
  expect(avatarMetrics.scrollWidth).toBeLessThanOrEqual(avatarMetrics.clientWidth);
  expect(avatarMetrics.scrollHeight).toBeLessThanOrEqual(avatarMetrics.clientHeight);
  expect(avatarMetrics.lineCount).toBe(1);
  expect(avatarMetrics.whiteSpace).toBe('nowrap');

  await page.screenshot({
    path: testInfo.outputPath('desktop-1440x900.png'),
    fullPage: true,
  });

  expect(errors).toEqual([]);
});

// --- Workbench daily card tests ---

const CARD_TASKS = [
  {
    id: 'card-1', name: '补交月报', source: '复盘', due: '2026-07-22 18:00', est: '1h',
    importance: '高', urgency: '高', owner: '张三',
    acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'card-2', name: '已完成的任务', source: '今天', due: '待确认', est: '1h',
    importance: '中', urgency: '低', owner: '待确认',
    acceptanceCriteria: [], nextAction: '', status: 'done', classificationSource: 'ai-extraction',
  },
];

test('workbench card loads daily tasks after login and shows read-only view', async ({ page }) => {
  const putRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/daily-tracking/today')
        && request.method() === 'PUT') {
      putRequests.push(request);
    }
  });

  // Override daily-tracking mock for this test
  await page.route('**/api/time-management/daily-tracking/today', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: CARD_TASKS,
        tracking: { 'card-2': { done: true, doneAt: '2026-07-22T17:00' } },
        removedTaskIds: [],
        revision: 0,
        sourceSummary: { historyCount: 1, taskCount: 2 },
        hasUnpersistedMerge: false,
      }),
    });
  }, { times: 1 }); // register before the beforeEach mock takes effect

  await page.goto('/');
  await expect(page.locator('.home-daily-card')).toContainText('今日任务 · 2026-07-23');
  await expect(page.locator('.home-daily-card')).toContainText('共 2 项，已完成 1 项');
  await expect(
    page.locator('.home-daily-card').getByRole('button', { name: '进入每日跟踪' }),
  ).toBeVisible();

  const cardOrder = await page.locator('.panelbox, .home-daily-card').evaluateAll(
    nodes => nodes.map(node => (
      node.classList.contains('home-daily-card') ? 'daily' : 'next'
    )),
  );
  expect(cardOrder).toEqual(['next', 'daily']);

  const expandButton = page.getByRole('button', { name: '展开今日任务列表' });
  await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  await expect(expandButton).toHaveAttribute('aria-controls', 'home-daily-task-list');
  await expect(page.locator('#home-daily-task-list')).toBeHidden();
  await expect(page.locator('.home-daily-task')).toHaveCount(0);

  await expandButton.click();
  await expect(
    page.getByRole('button', { name: '收起今日任务列表' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#home-daily-task-list')).toBeVisible();
  await expect(page.locator('.home-daily-task')).toHaveCount(2);
  await expect(page.locator('.home-daily-task').first()).toContainText('2026-07-22');
  await expect(page.locator('.home-daily-task').first()).not.toContainText('18:00');
  await expect(page.locator('.home-daily-task').first()).toContainText('责任人：张三');
  await expect(page.locator('.home-daily-task').last()).toContainText('已完成');
  await expect(page.locator('.home-daily-task').last()).toContainText('责任人：待确认');

  await page.getByRole('button', { name: '收起今日任务列表' }).click();
  await expect(page.locator('.home-daily-task')).toHaveCount(0);
  expect(putRequests).toHaveLength(0);
});

test('workbench daily expansion survives navigation but resets after refresh', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '展开今日任务列表' }).click();
  await expect(page.locator('.home-daily-task')).toHaveCount(TASKS.length);

  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('工作台');

  await expect(
    page.getByRole('button', { name: '收起今日任务列表' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.home-daily-task')).toHaveCount(TASKS.length);

  await page.reload();

  await expect(
    page.getByRole('button', { name: '展开今日任务列表' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.home-daily-task')).toHaveCount(0);
});

test('workbench card "进入每日跟踪" button opens editable daily page', async ({ page }) => {
  await page.goto('/');
  await page.locator('.home-daily-card').getByRole('button', { name: '进入每日跟踪' }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expect(page.locator('[data-daily-task-field="due"]')).toHaveCount(4);
});

test('workbench card shows empty state when no tasks', async ({ page }) => {
  await page.route('**/api/time-management/daily-tracking/today', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: [],
        tracking: {},
        removedTaskIds: [],
        revision: 0,
        sourceSummary: { historyCount: 0, taskCount: 0 },
        hasUnpersistedMerge: false,
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.home-daily-card')).toContainText('今天还没有任务');
  await expect(page.locator('.home-daily-task')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /今日任务列表/ }),
  ).toHaveCount(0);
});

test('workbench card shows local error on 500 while four distribution cards remain', async ({ page }) => {
  await page.route('**/api/time-management/daily-tracking/today', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await expect(page.locator('.home-daily-card')).toContainText('今日任务加载失败');
  await expect(page.locator('.hcard')).toHaveCount(4);
  await expect(
    page.getByRole('button', { name: /今日任务列表/ }),
  ).toHaveCount(0);
});

test('workbench card retry recovers on second GET', async ({ page }) => {
  let getCount = 0;
  await page.route('**/api/time-management/daily-tracking/today', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    getCount++;
    if (getCount === 1) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: [{
          id: 'card-task-1', name: '恢复后的任务', source: '今天',
          due: '2026-07-23', est: '1h', owner: '待确认',
          importance: '高', urgency: '高',
          acceptanceCriteria: [], nextAction: '', status: 'pending',
          classificationSource: 'ai-extraction',
        }],
        tracking: {},
        removedTaskIds: [],
        revision: 0,
        sourceSummary: { historyCount: 1, taskCount: 1 },
        hasUnpersistedMerge: false,
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.home-daily-card')).toContainText('今日任务加载失败');
  await page.locator('[data-action="reload-home-daily"]').click();
  await expect(
    page.getByRole('button', { name: '展开今日任务列表' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '展开今日任务列表' }).click();
  await expect(page.locator('.home-daily-card')).toContainText('恢复后的任务');
  await expect(page.locator('.hcard')).toHaveCount(4);
});

// --- Carryover isolation test ---

const CARRIED_TASK = {
  id: 'carry-01-carry-01-carry-01-carry-carry01',
  name: '跨日遗留：补交上周月报',
  source: '复盘',
  due: '2026-07-22',
  est: '1h',
  owner: '张三',
  importance: '高',
  urgency: '高',
  acceptanceCriteria: [],
  nextAction: '',
  status: 'pending',
  classificationSource: 'ai-extraction',
};

test('carried daily task stays in workbench and daily tracking but never enters a new five-step run', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const putRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/daily-tracking/today')
        && request.method() === 'PUT') {
      putRequests.push(request);
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });

  // Override daily-tracking mock to only return the carried task for all GETs
  await page.route('**/api/time-management/daily-tracking/today', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          trackingDate: '2026-07-23',
          tasks: body?.tasks || [CARRIED_TASK],
          tracking: body?.tracking || {},
          removedTaskIds: body?.removedTaskIds || [],
          revision: 1,
          updatedAt: '2026-07-23T02:00:00.000Z',
          sourceSummary: { historyCount: 0, taskCount: 1 },
          hasUnpersistedMerge: false,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: [CARRIED_TASK],
        tracking: {},
        removedTaskIds: [],
        revision: 0,
        sourceSummary: { historyCount: 0, taskCount: 1 },
        hasUnpersistedMerge: false,
      }),
    });
  });

  await page.goto('/');

  // Workbench: carried task is available only after expanding the read-only list
  await expect(page.locator('.home-daily-task')).toHaveCount(0);
  await page.getByRole('button', { name: '展开今日任务列表' }).click();
  await expect(page.locator('.home-daily-card')).toContainText('跨日遗留');
  await expect(page.locator('.home-daily-card')).toContainText('2026-07-22');
  await expect(page.locator('.home-daily-card')).toContainText('责任人：张三');

  // Daily tracking: carried task is visible with correct ID
  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expect(page.locator(`[data-daily-task-field="name"][data-daily-task-id="${CARRIED_TASK.id}"]`)).toHaveValue('跨日遗留：补交上周月报');
  await expect(page.locator(`[data-daily-task-field="owner"][data-daily-task-id="${CARRIED_TASK.id}"]`)).toHaveValue('张三');
  await expect(page.locator(`[data-daily-task-field="due"][data-daily-task-id="${CARRIED_TASK.id}"]`)).toHaveValue('2026-07-22');

  // Return to workbench and start a new five-step run
  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#entry-昨天').fill('补交上周未完成的月报');
  await page.locator('#entry-今天').fill('完成今天的方案终稿校对');
  await page.locator('#entry-明天').fill('梳理内容审核流程规范');
  await page.locator('#entry-后天').fill('制定团队能力建设季度规划');
  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('AI 拆解确认');

  // Carried task must NOT appear in five-step step 2 confirmation table
  await expect(page.locator(`[data-task-row="${CARRIED_TASK.id}"]`)).toHaveCount(0);
  // But TASKS from the new run should be present
  for (const task of TASKS) {
    await expect(page.locator(`[data-task-row="${task.id}"]`)).toHaveCount(1);
  }

  // Complete the rest of the five steps
  await page.getByRole('button', { name: 'SMART 校验' }).click();
  await expect(page.locator('#panel').getByText('全部任务通过 SMART 校验')).toBeVisible();
  await page.getByRole('button', { name: /时间分布诊断/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('时间分布诊断');
  await page.getByRole('button', { name: /优先级排序/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级排序');

  // Matrix must not contain the carried task's name
  await expect(page.locator('.qt').filter({ hasText: '跨日遗留' })).toHaveCount(0);

  await page.getByRole('button', { name: /生成优化报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('时间投入优化报告');

  // Report must not contain the carried task's name
  await expect(page.getByText('跨日遗留：补交上周月报')).toHaveCount(0);

  // Normal GET must not trigger PUT
  expect(putRequests).toHaveLength(0);

  // No page errors
  expect(browserErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // No horizontal overflow
  await expectNoPageOverflow(page);
});

const { test, expect } = require('@playwright/test');

const TASKS = [
  {
    id: 'task-y', name: '补交上周未完成的月报', source: '复盘', due: '2026-07-22', est: '1h',
    importance: '高', urgency: '高', acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'task-t', name: '完成今天的方案终稿校对', source: '今天', due: '2026-07-22', est: '7h',
    importance: '高', urgency: '高', acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'task-m', name: '梳理内容审核流程规范', source: '短期目标', due: '2026-07-26', est: '1.5h',
    importance: '高', urgency: '低', acceptanceCriteria: ['形成可评审的流程文档'], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: 'task-f', name: '制定团队能力建设季度规划', source: '中长期', due: '2026-09-30', est: '30分钟',
    importance: '高', urgency: '低', acceptanceCriteria: ['形成三个里程碑'], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
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
      body: JSON.stringify({ id: 'history-1', ...body, createdAt: '2026-07-22T12:00:00.000Z', updatedAt: '2026-07-22T12:00:00.000Z' }),
    });
  });
}

async function completeFiveSteps(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#entry-昨天').fill('补交上周未完成的月报');
  await page.locator('#entry-今天').fill('完成今天的方案终稿校对');
  await page.locator('#entry-明天').fill('梳理内容审核流程规范');
  await page.locator('#entry-后天').fill('制定团队能力建设季度规划');
  await page.getByRole('button', { name: /AI 拆解为任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('AI 拆解确认');
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

test('新版参考界面完整贯穿五步后端流程', async ({ page }) => {
  await completeFiveSteps(page);
  await expect(page.locator('.step')).toHaveCount(5);
  await expect(page.getByText('今日执行顺序')).toBeVisible();
  await expect(page.getByText('时间投入优化目标')).toBeVisible();
  await expect(page.getByRole('heading', { name: '改变与举措', exact: true })).toBeVisible();
  await expect(page.getByText('历史已保存。')).toBeVisible();
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

test('工作台、每日跟踪和历史记录使用参考稿导航', async ({ page }) => {
  await completeFiveSteps(page);
  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expect(page.locator('.g-daily')).toHaveCount(3);
  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('工作台');
  await expect(page.locator('.hcard')).toHaveCount(4);
});

test('375px 窄屏无整页横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await expect(page.locator('.cols4')).toBeVisible();
});

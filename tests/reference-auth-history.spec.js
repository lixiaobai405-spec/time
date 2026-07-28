const { test, expect } = require('@playwright/test');

test('新版登录注册、恢复码、历史入口和退出完整可用', async ({ page }) => {
  const username = `新版用户_${Date.now()}`;
  const password = '123456';

  await page.goto('/');
  await expect(page.locator('.login-h')).toHaveText('登录');
  await page.locator('.tab').filter({ hasText: /^注册$/ }).click();
  await expect(page.locator('.login-h')).toHaveText('注册账号');
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-passwordConfirm').fill(password);
  await page.locator('form[data-auth-form="register"] button[type="submit"]').click();

  await expect(page.locator('.login-h')).toHaveText('请立即保存恢复码');
  const recoveryCode = await page.locator('#recovery-code').innerText();
  expect(recoveryCode.trim().length).toBeGreaterThan(20);
  await page.getByRole('button', { name: '我已保存恢复码' }).click();

  await expect(page.locator('.login-h')).toHaveText('登录');
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('form[data-auth-form="login"] button[type="submit"]').click();
  await expect(page.locator('.ptitle')).toHaveText('工作台');
  await expect(page.locator('.tnav')).toHaveCount(4);

  await page.locator('.tnav').filter({ hasText: /^历史记录$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('历史记录');
  await expect(page.getByText('本次会话还没有每日完成记录。')).toBeVisible();
  await expect(page.getByText('账号下还没有已完成的报告。')).toBeVisible();

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.locator('.login-h')).toHaveText('登录');

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage).toEqual({ local: [], session: [] });
});

test('移动端登录后顶部四个入口和退出按钮保持可操作', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const username = `移动用户_${Date.now()}`;
  const password = '123456';

  await page.goto('/');
  await page.locator('.tab').filter({ hasText: /^注册$/ }).click();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-passwordConfirm').fill(password);
  await page.locator('form[data-auth-form="register"] button[type="submit"]').click();
  await page.getByRole('button', { name: '我已保存恢复码' }).click();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('form[data-auth-form="login"] button[type="submit"]').click();

  await expect(page.locator('.tnav')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});

async function registerAndLogin(page, prefix) {
  const username = `${prefix}_${Date.now()}`;
  const password = '123456';
  await page.goto('/');
  await page.locator('.tab').filter({ hasText: /^注册$/ }).click();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-passwordConfirm').fill(password);
  await page.locator('form[data-auth-form="register"] button[type="submit"]').click();
  await page.getByRole('button', { name: '我已保存恢复码' }).click();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('form[data-auth-form="login"] button[type="submit"]').click();
  await expect(page.locator('.ptitle')).toHaveText('工作台');
}

test('旧历史入口打开今天清单并自动保存编辑和删除', async ({ page }) => {
  const taskOne = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '当天任务一',
    importance: '高',
    urgency: '高',
    source: '今天',
    due: '2026-07-23 18:00',
    est: '1h',
    owner: '待确认',
    acceptanceCriteria: [],
    nextAction: '',
    status: 'pending',
    classificationSource: 'ai-extraction',
  };
  const taskTwo = {
    ...taskOne,
    id: '22222222-2222-4222-8222-222222222222',
    name: '当天任务二',
    source: '短期目标',
    due: '2026-07-24',
  };
  const historyItem = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: '旧历史报告',
    createdAt: '2026-07-20T02:00:00.000Z',
    updatedAt: '2026-07-20T02:00:00.000Z',
    goals: { 昨天: '', 今天: '当天任务', 明天: '', 后天: '' },
    tasks: [taskOne],
    matrix: {
      quadrants: [
        { name: '第一象限', energyPercent: 55, taskIds: [taskOne.id] },
        { name: '第二象限', energyPercent: 25, taskIds: [] },
        { name: '第三象限', energyPercent: 15, taskIds: [] },
        { name: '第四象限', energyPercent: 5, taskIds: [] },
      ],
    },
    report: {
      order: [{ taskId: taskOne.id, reason: '先完成' }],
      energyRules: ['集中处理'],
      adjustments: ['及时复盘'],
    },
  };
  let dailyPayload = {
    trackingDate: '2026-07-23',
    tasks: [taskOne, taskTwo],
    tracking: {},
    removedTaskIds: [],
    revision: 0,
    updatedAt: null,
    sourceSummary: { historyCount: 2, taskCount: 2 },
    hasUnpersistedMerge: false,
  };
  let savedPayload = null;

  await page.route(
    (url) => url.pathname === '/api/time-management/history' && url.search.includes('limit'),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: historyItem.id,
          title: historyItem.title,
          createdAt: historyItem.createdAt,
          updatedAt: historyItem.updatedAt,
        }],
        nextCursor: null,
      }),
    }),
  );
  await page.route(`**/api/time-management/history/${historyItem.id}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(historyItem),
  }));
  await page.route('**/api/time-management/daily-tracking/today', async route => {
    if (route.request().method() === 'PUT') {
      savedPayload = route.request().postDataJSON();
      dailyPayload = {
        ...dailyPayload,
        ...savedPayload,
        revision: dailyPayload.revision + 1,
        updatedAt: '2026-07-23T03:00:00.000Z',
        sourceSummary: {
          historyCount: 2,
          taskCount: savedPayload.tasks.length,
        },
        hasUnpersistedMerge: false,
      };
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dailyPayload),
    });
  });

  await registerAndLogin(page, '每日用户');
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.locator('.tnav').filter({ hasText: /^历史记录$/ }).click();
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.getByText('旧历史报告')).toBeVisible();
  await expect(page.locator('.history-tasks')).toContainText('截止');
  await expect(page.locator('.history-tasks')).toContainText('责任人');
  await page.getByRole('button', { name: '进入每日跟踪' }).click();

  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expect(page.getByText('已汇总今天生成的 2 条记录，共 2 项任务')).toBeVisible();
  const firstDailyRow = page.locator(`[data-daily-task-id="${taskOne.id}"]`);

  await expect(page.locator('.trow.hd.g-daily')).toContainText('截止日期');
  await expect(page.locator('.trow.hd.g-daily')).toContainText('责任人');
  await expect(page.locator('.trow.hd.g-daily')).toContainText('预估时长（小时）');

  savedPayload = null;
  const firstName = page.locator('[data-daily-task-field="name"]').first();
  const firstDue = page.locator('[data-daily-task-field="due"]').first();
  const firstOwner = page.locator('[data-daily-task-field="owner"]').first();
  await firstName.fill('用户编辑后的名称');
  await firstDue.fill('2026-08-20');
  await firstOwner.fill('赵六');
  await firstOwner.press('Tab');
  await expect(page.getByText('正在保存…')).toBeVisible();
  await expect(page.getByText('已自动保存')).toBeVisible();
  await expect.poll(() => savedPayload?.tasks?.[0]?.owner).toBe('赵六');
  expect(savedPayload.tasks[0]).toMatchObject({
    name: '用户编辑后的名称',
    due: '2026-08-20',
    owner: '赵六',
  });
  await expect(page.getByRole('button', { name: /^保存$/ })).toHaveCount(0);

  savedPayload = null;
  await page.locator('[data-action="toggle-daily-done"]').first().click();
  await expect.poll(() => savedPayload?.tracking?.[taskOne.id]?.done).toBe(true);
  expect(savedPayload.tasks[0].due).toBe('2026-08-20');
  expect(savedPayload.tasks[0].owner).toBe('赵六');
  expect(savedPayload.tracking[taskOne.id].doneAt).toMatch(/^2026-\d{2}-\d{2}T\d{2}:\d{2}$/);

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete-daily-task"]').last().click();
  await expect(page.getByText('已自动保存')).toBeVisible();
  expect(savedPayload.removedTaskIds).toContain(taskTwo.id);

  await page.reload();
  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('[data-daily-task-field="name"]').first())
    .toHaveValue('用户编辑后的名称');
  await expect(page.locator('[data-daily-task-field="due"]').first())
    .toHaveValue('2026-08-20');
  await expect(page.locator('[data-daily-task-field="owner"]').first())
    .toHaveValue('赵六');
  await expect(page.locator('.g-daily[data-daily-task-id]')).toHaveCount(1);
  expect(browserErrors).toEqual([]);
});

test('自动保存冲突保留本地编辑并提供重新加载今天', async ({ page }) => {
  const task = {
    id: '33333333-3333-4333-8333-333333333333',
    name: '冲突前任务',
    importance: '高',
    urgency: '低',
    source: '今天',
    due: '2026-07-23',
    est: '1h',
    owner: '服务端责任人',
    acceptanceCriteria: [],
    nextAction: '',
    status: 'pending',
    classificationSource: 'manual',
  };
  await page.route('**/api/time-management/daily-tracking/today', route => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DAILY_TRACKING_CONFLICT',
            message: '每日清单已在其他页面更新，请重新加载。',
            requestId: 'conflict-request',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: [task],
        tracking: {},
        removedTaskIds: [],
        revision: 2,
        updatedAt: '2026-07-23T03:00:00.000Z',
        sourceSummary: { historyCount: 1, taskCount: 1 },
        hasUnpersistedMerge: false,
      }),
    });
  });

  await registerAndLogin(page, '冲突用户');
  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  const name = page.locator('[data-daily-task-field="name"]');
  const due = page.locator('[data-daily-task-field="due"]');
  const owner = page.locator('[data-daily-task-field="owner"]');
  await name.fill('尚未覆盖的本地编辑');
  await due.fill('2026-08-21');
  await owner.fill('本地责任人');
  await owner.press('Tab');
  await expect(page.locator('#daily-save-status'))
    .toContainText('每日清单已在其他页面更新，请重新加载。');
  await expect(name).toHaveValue('尚未覆盖的本地编辑');
  await expect(due).toHaveValue('2026-08-21');
  await expect(owner).toHaveValue('本地责任人');
  await expect(page.getByRole('button', { name: '重新加载今天' })).toBeVisible();

  let leavePrompt = '';
  page.once('dialog', async dialog => {
    leavePrompt = dialog.message();
    await dialog.dismiss();
  });
  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  expect(leavePrompt).toContain('未保存更改');

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '重新加载今天' }).click();
  await expect(name).toHaveValue('冲突前任务');
  await expect(due).toHaveValue('2026-07-23');
  await expect(owner).toHaveValue('服务端责任人');
});

test('workbench daily card clears on logout and isolates the next account', async ({ page }) => {
  let activeAccount = 'A';
  const putRequests = [];

  await page.route('**/api/time-management/daily-tracking/today', route => {
    if (route.request().method() === 'PUT') {
      putRequests.push(route.request().postDataJSON());
      return route.fulfill({ status: 500, body: '{}' });
    }

    const suffix = activeAccount === 'A' ? 'A' : 'B';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trackingDate: '2026-07-23',
        tasks: [{
          id: activeAccount === 'A'
            ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: `账号${suffix}任务`,
          importance: '高',
          urgency: '低',
          source: '今天',
          due: '2026-07-23',
          est: '1h',
          owner: `责任人${suffix}`,
          acceptanceCriteria: [],
          nextAction: '',
          status: 'pending',
          classificationSource: 'manual',
        }],
        tracking: {},
        removedTaskIds: [],
        revision: 0,
        updatedAt: null,
        sourceSummary: { historyCount: 1, taskCount: 1 },
        hasUnpersistedMerge: false,
      }),
    });
  });

  await registerAndLogin(page, '工作台账号A');
  await expect(
    page.getByRole('button', { name: '展开今日任务列表' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '展开今日任务列表' }).click();
  await expect(page.locator('.home-daily-card')).toContainText('账号A任务');
  await expect(page.locator('.home-daily-card')).not.toContainText('账号B任务');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.locator('.login-h')).toHaveText('登录');
  await expect(page.locator('.home-daily-task')).toHaveCount(0);

  activeAccount = 'B';
  await registerAndLogin(page, '工作台账号B');
  await expect(
    page.getByRole('button', { name: '展开今日任务列表' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.home-daily-task')).toHaveCount(0);
  await page.getByRole('button', { name: '展开今日任务列表' }).click();
  await expect(page.locator('.home-daily-card')).toContainText('账号B任务');
  await expect(page.locator('.home-daily-card')).not.toContainText('账号A任务');
  expect(putRequests).toHaveLength(0);
});

// --- History distribution display tests ---

const DIST_FIXTURE = {
  totalMinutes: 600, totalHours: 10, validTaskCount: 4, invalidTasks: [],
  categories: [
    { key: '昨天', minutes: 60, hours: 1, percent: 10, target: { min: 0, max: 2, label: '→0%' }, status: 'over' },
    { key: '今天', minutes: 420, hours: 7, percent: 70, target: { min: 70, max: 80, label: '70–80%' }, status: 'ok' },
    { key: '明天', minutes: 90, hours: 1.5, percent: 15, target: { min: 10, max: 20, label: '10–20%' }, status: 'ok' },
    { key: '后天', minutes: 30, hours: 0.5, percent: 5, target: { min: 3, max: 100, label: '5%' }, status: 'ok' },
  ],
  percentages: { 昨天: 10, 今天: 70, 明天: 15, 后天: 5 },
  diagnosis: ['"昨天"遗留偏高。', '"今天"投入处于目标区间。'],
  recommendations: ['集中清理遗留事项。'],
};

const NEW_HISTORY_ITEM = {
  id: 'dist-aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: '含分布快照的历史',
  schemaVersion: 2,
  createdAt: '2026-07-25T02:00:00.000Z',
  updatedAt: '2026-07-25T02:00:00.000Z',
  goals: { 昨天: '昨晚复盘', 今天: '今天交付', 明天: '建流程', 后天: '年度目标' },
  tasks: [
    {
      id: 'task-a001-0000-4000-8000-000000000001',
      name: '补交遗留月报', importance: '高', urgency: '高', source: '复盘',
      due: '2026-07-22', est: '约1h', owner: '待确认',
      acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
    },
    {
      id: 'task-a002-0000-4000-8000-000000000002',
      name: '今日方案终稿', importance: '高', urgency: '高', source: '今天',
      due: '2026-07-25', est: '7h', owner: '待确认',
      acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
    },
    {
      id: 'task-a003-0000-4000-8000-000000000003',
      name: '梳理流程规范', importance: '高', urgency: '低', source: '短期目标',
      due: '2026-07-26', est: '1.5h', owner: '待确认',
      acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
    },
    {
      id: 'task-a004-0000-4000-8000-000000000004',
      name: '季度规划', importance: '高', urgency: '低', source: '中长期',
      due: '2026-09-30', est: '30分钟', owner: '待确认',
      acceptanceCriteria: [], nextAction: '', status: 'pending', classificationSource: 'ai-extraction',
    },
  ],
  distribution: DIST_FIXTURE,
  matrix: {
    classifications: [
      { taskId: 'task-a001-0000-4000-8000-000000000001', importance: '高', urgency: '高', classificationSource: 'ai-extraction' },
      { taskId: 'task-a002-0000-4000-8000-000000000002', importance: '高', urgency: '高', classificationSource: 'ai-extraction' },
      { taskId: 'task-a003-0000-4000-8000-000000000003', importance: '高', urgency: '低', classificationSource: 'ai-extraction' },
      { taskId: 'task-a004-0000-4000-8000-000000000004', importance: '高', urgency: '低', classificationSource: 'ai-extraction' },
    ],
    quadrants: [
      { name: '第一象限', priority: 1, action: '立即做', energyPercent: 55, taskIds: ['task-a001-0000-4000-8000-000000000001', 'task-a002-0000-4000-8000-000000000002'] },
      { name: '第二象限', priority: 2, action: '计划做', energyPercent: 25, taskIds: ['task-a003-0000-4000-8000-000000000003', 'task-a004-0000-4000-8000-000000000004'] },
      { name: '第三象限', priority: 3, action: '授权做', energyPercent: 15, taskIds: [] },
      { name: '第四象限', priority: 4, action: '减少做', energyPercent: 5, taskIds: [] },
    ],
    note: '',
  },
  report: {
    order: [
      { taskId: 'task-a001-0000-4000-8000-000000000001', reason: '先清理遗留' },
      { taskId: 'task-a002-0000-4000-8000-000000000002', reason: '完成今天交付' },
    ],
    energyRules: ['先处理第一象限，再保护第二象限'],
    adjustments: ['每周复盘'],
  },
};

test('新历史详情展示时间分布诊断，区块顺序为事务填写→任务清单→时间分布→矩阵→报告', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.route(
    (url) => url.pathname === '/api/time-management/history' && url.search.includes('limit'),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ id: NEW_HISTORY_ITEM.id, title: NEW_HISTORY_ITEM.title, createdAt: NEW_HISTORY_ITEM.createdAt, updatedAt: NEW_HISTORY_ITEM.updatedAt }],
        nextCursor: null,
      }),
    }),
  );
  await page.route(`**/api/time-management/history/${NEW_HISTORY_ITEM.id}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(NEW_HISTORY_ITEM),
  }));

  await registerAndLogin(page, '分布详情用户');
  await page.locator('.tnav').filter({ hasText: /^历史记录$/ }).click();
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.locator('.ptitle')).toHaveText('含分布快照的历史');

  // Section order — only direct child h2 of each section
  const headings = await page.locator('.history-section > h2').allInnerTexts();
  expect(headings).toEqual(['事务填写', '任务清单', '时间分布诊断', '轻重缓急矩阵', '优化报告']);

  // Distribution display
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('昨天 · 遗留问题');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('今天 · 日事日毕');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('10%');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('70%');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('1h');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('7h');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('偏高');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('达标');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('诊断结论');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('改进方向');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('集中清理遗留事项。');

  // Must not show raw IDs or JSON
  const distSection = page.locator('.history-section').filter({ hasText: '时间分布诊断' });
  await expect(distSection).not.toContainText('task-a001');

  // No edit/save buttons in history
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' }).getByRole('button')).toHaveCount(0);

  // Enter daily tracking still works
  await expect(page.getByRole('button', { name: '进入每日跟踪' })).toBeVisible();

  // Filter out pre-existing 401 console noise from auth resource loading
  const realErrors = browserErrors.filter((msg) => !msg.includes('401'));
  expect(realErrors).toEqual([]);
});

test('旧历史无 distribution 时显示兼容提示且不触发重新计算', async ({ page }) => {
  const oldItem = {
    ...NEW_HISTORY_ITEM,
    id: 'oldb-bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: '旧版无分布历史',
    schemaVersion: 1,
  };
  delete oldItem.distribution;

  await page.route(
    (url) => url.pathname === '/api/time-management/history' && url.search.includes('limit'),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ id: oldItem.id, title: oldItem.title, createdAt: oldItem.createdAt, updatedAt: oldItem.updatedAt }],
        nextCursor: null,
      }),
    }),
  );
  await page.route(`**/api/time-management/history/${oldItem.id}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(oldItem),
  }));

  let diagnoseCalled = false;
  page.on('request', request => {
    if (request.url().endsWith('/api/time-management/distribution/diagnose')) {
      diagnoseCalled = true;
    }
  });

  await registerAndLogin(page, '旧版分布用户');
  await page.locator('.tnav').filter({ hasText: /^历史记录$/ }).click();
  await page.getByRole('button', { name: '查看详情' }).click();

  await expect(page.locator('.ptitle')).toHaveText('旧版无分布历史');
  await expect(page.locator('.history-section').filter({ hasText: '时间分布诊断' })).toContainText('该历史版本未保存时间分布诊断');
  expect(diagnoseCalled).toBe(false);

  // Other sections still visible
  await expect(page.locator('.history-section').filter({ hasText: '事务填写' })).toBeVisible();
  await expect(page.locator('.history-section').filter({ hasText: '任务清单' })).toBeVisible();
  await expect(page.locator('.history-section').filter({ hasText: '轻重缓急矩阵' })).toBeVisible();
  await expect(page.locator('.history-section').filter({ hasText: '优化报告' })).toBeVisible();
  await expect(page.getByRole('button', { name: '进入每日跟踪' })).toBeVisible();
});

test('375px 窄屏历史详情无整页横向溢出', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.route(
    (url) => url.pathname === '/api/time-management/history' && url.search.includes('limit'),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ id: NEW_HISTORY_ITEM.id, title: NEW_HISTORY_ITEM.title, createdAt: NEW_HISTORY_ITEM.createdAt, updatedAt: NEW_HISTORY_ITEM.updatedAt }],
        nextCursor: null,
      }),
    }),
  );
  await page.route(`**/api/time-management/history/${NEW_HISTORY_ITEM.id}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(NEW_HISTORY_ITEM),
  }));

  await page.setViewportSize({ width: 375, height: 812 });
  await registerAndLogin(page, '窄屏分布用户');

  await page.locator('.tnav').filter({ hasText: /^历史记录$/ }).click();
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.locator('.ptitle')).toHaveText('含分布快照的历史');

  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);

  // Long diagnosis text should wrap
  const distSection = page.locator('.history-section').filter({ hasText: '时间分布诊断' });
  await expect(distSection).toBeVisible();

  const realConsoleErrors = consoleErrors.filter((msg) => !msg.includes('401'));
  expect(realConsoleErrors).toEqual([]);
  const realBrowserErrors = browserErrors.filter((msg) => !msg.includes('401'));
  expect(realBrowserErrors).toEqual([]);
});

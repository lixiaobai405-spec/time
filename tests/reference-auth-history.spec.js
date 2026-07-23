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

  await page.route('**/api/time-management/history?**', route => route.fulfill({
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
  }));
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
  await page.locator('.tnav').filter({ hasText: /^历史记录$/ }).click();
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.getByText('旧历史报告')).toBeVisible();
  await page.getByRole('button', { name: '进入每日跟踪' }).click();

  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  await expect(page.getByText('已汇总今天生成的 2 条记录，共 2 项任务')).toBeVisible();
  const firstDailyRow = page.locator(`[data-daily-task-id="${taskOne.id}"]`);
  const dueDate = firstDailyRow.locator('[data-daily-due-part="dueDate"]');
  const dueTime = firstDailyRow.locator('[data-daily-due-part="dueTime"]');

  await expect(dueDate).toHaveAttribute('type', 'date');
  await expect(dueTime).toHaveAttribute('type', 'time');
  await expect(dueDate).toHaveValue('2026-07-23');
  await expect(dueTime).toHaveValue('18:00');

  savedPayload = null;
  await dueDate.fill('2026-07-25');
  await dueTime.fill('19:30');
  await expect.poll(() => savedPayload?.tasks?.[0]?.due)
    .toBe('2026-07-25 19:30');

  savedPayload = null;
  await dueTime.fill('');
  await expect.poll(() => savedPayload?.tasks?.[0]?.due)
    .toBe('2026-07-25');

  savedPayload = null;
  await dueDate.fill('');
  await expect(dueTime).toBeDisabled();
  await expect(dueTime).toHaveValue('');
  await expect.poll(() => savedPayload?.tasks?.[0]?.due)
    .toBe('待确认');

  const firstName = page.locator('[data-daily-task-field="name"]').first();
  await firstName.fill('用户编辑后的名称');
  await expect(page.getByText('正在保存…')).toBeVisible();
  await expect(page.getByText('已自动保存')).toBeVisible();
  expect(savedPayload.tasks[0].name).toBe('用户编辑后的名称');
  await expect(page.getByRole('button', { name: /^保存$/ })).toHaveCount(0);

  savedPayload = null;
  await page.locator('[data-action="toggle-daily-done"]').first().click();
  await expect.poll(() => savedPayload?.tracking?.[taskOne.id]?.done).toBe(true);
  expect(savedPayload.tracking[taskOne.id].doneAt).toMatch(/^2026-\d{2}-\d{2}T\d{2}:\d{2}$/);

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete-daily-task"]').last().click();
  await expect(page.getByText('已自动保存')).toBeVisible();
  expect(savedPayload.removedTaskIds).toContain(taskTwo.id);

  await page.reload();
  await page.locator('.tnav').filter({ hasText: /^每日跟踪$/ }).click();
  await expect(page.locator('[data-daily-task-field="name"]').first())
    .toHaveValue('用户编辑后的名称');
  await expect(page.locator('.g-daily[data-daily-task-id]')).toHaveCount(1);
});

test('自动保存冲突保留本地编辑并提供重新加载今天', async ({ page }) => {
  const task = {
    id: '33333333-3333-4333-8333-333333333333',
    name: '冲突前任务',
    importance: '高',
    urgency: '低',
    source: '今天',
    due: '今天',
    est: '1h',
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
  await name.fill('尚未覆盖的本地编辑');
  await expect(page.locator('#daily-save-status'))
    .toContainText('每日清单已在其他页面更新，请重新加载。');
  await expect(name).toHaveValue('尚未覆盖的本地编辑');
  await expect(page.getByRole('button', { name: '重新加载今天' })).toBeVisible();

  let leavePrompt = '';
  page.once('dialog', async dialog => {
    leavePrompt = dialog.message();
    await dialog.dismiss();
  });
  await page.locator('.tnav').filter({ hasText: /^工作台$/ }).click();
  await expect(page.locator('.ptitle')).toHaveText('每日跟踪');
  expect(leavePrompt).toContain('未保存更改');
});

const { expect, test } = require('@playwright/test');

const PASSWORD = 'Ui-History-Horse-2026';
const NEW_PASSWORD = 'Ui-New-History-Horse-2026';
const TASK_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const GOALS = Object.freeze({
  昨天: '完成复盘并记录原因与改进',
  今天: '今天18:00前提交一份方案',
  明天: '本周五前完成一份验收清单',
  后天: '年底前完成年度目标并按月复盘',
});
const TASKS = [
  {
    id: TASK_IDS[0], name: '提交方案', importance: '高', urgency: '高', source: '今天',
    due: '今天18:00', est: '约1h', acceptanceCriteria: ['方案已提交'], nextAction: '',
    status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: TASK_IDS[1], name: '完成验收清单', importance: '高', urgency: '低', source: '短期目标',
    due: '本周五', est: '约2h', acceptanceCriteria: ['清单可执行'], nextAction: '',
    status: 'pending', classificationSource: 'ai-extraction',
  },
  {
    id: TASK_IDS[2], name: '整理临时资料', importance: '低', urgency: '低', source: '临时',
    due: '待确认', est: '30分钟', acceptanceCriteria: [], nextAction: '',
    status: 'pending', classificationSource: 'ai-extraction',
  },
];
const MATRIX = Object.freeze({
  classifications: TASKS.map(task => ({
    taskId: task.id,
    importance: task.importance,
    urgency: task.urgency,
    classificationSource: task.classificationSource,
  })),
  quadrants: [
    { name: '第一象限', priority: 1, action: '立即做', energyPercent: 55, taskIds: [TASK_IDS[0]] },
    { name: '第二象限', priority: 2, action: '计划做', energyPercent: 25, taskIds: [TASK_IDS[1]] },
    { name: '第三象限', priority: 3, action: '授权做', energyPercent: 15, taskIds: [] },
    { name: '第四象限', priority: 4, action: '减少做', energyPercent: 5, taskIds: [TASK_IDS[2]] },
  ],
  note: '',
});
const REPORT = Object.freeze({
  order: TASKS.map(task => ({ taskId: task.id, reason: `${task.name}是当前优先事项` })),
  energyRules: ['优先完成第一象限，并为第二象限预留整块时间'],
  adjustments: ['每周固定复盘一次'],
});

async function registerThroughApi(page, username, password = PASSWORD) {
  await page.evaluate(async ({ name, secret }) => {
    const csrfResponse = await fetch('/api/auth/csrf');
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ username: name, password: secret }),
    });
    if (!response.ok) throw new Error(`registration failed: ${response.status}`);
  }, { name: username, secret: password });
}

async function registerAndLogin(page, username, password = PASSWORD) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册账号' }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  const recoveryCode = await page.locator('#recovery-code').innerText();
  await page.getByRole('button', { name: '我已保存恢复码' }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('button', { name: /开始梳理/ })).toBeVisible();
  return recoveryCode;
}

async function loginExisting(page, username, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('button', { name: /开始梳理/ })).toBeVisible();
}

async function installWorkflowMocks(page) {
  await page.route('**/api/time-management/goals/check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      fields: Object.keys(GOALS).map(key => ({ key, status: 'ok', issue: '', suggestion: '' })),
      overall: 'pass',
    }),
  }));
  await page.route('**/api/time-management/tasks/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tasks: TASKS }),
  }));
  await page.route('**/api/time-management/matrix/classify', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(MATRIX),
  }));
  await page.route('**/api/time-management/report/generate', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(REPORT),
  }));
}

async function completeWorkflow(page) {
  await page.getByRole('button', { name: /开始梳理/ }).click();
  for (const [selector, key] of [
    ['#g-昨', '昨天'], ['#g-今', '今天'], ['#g-明', '明天'], ['#g-后', '后天'],
  ]) {
    await page.locator(selector).fill(GOALS[key]);
  }
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();
  await page.getByRole('button', { name: /提取任务/ }).click();
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await page.getByRole('button', { name: /生成报告/ }).click();
}

function historySnapshot(title, clientRunId) {
  return {
    clientRunId,
    title,
    goals: GOALS,
    tasks: TASKS,
    matrix: MATRIX,
    report: REPORT,
  };
}

async function saveThroughApi(page, snapshot) {
  return page.evaluate(async value => {
    const { state } = await import('/state.js');
    const response = await fetch('/api/time-management/history', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': state.csrfToken,
      },
      body: JSON.stringify(value),
    });
    return { status: response.status, body: await response.json() };
  }, snapshot);
}

async function openHistory(page) {
  const button = page.getByRole('button', { name: '历史记录' });
  await expect(button).toBeVisible();
  await button.click();
}

test('未登录显示登录页且不能进入工作区', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '登录时间管理助手' })).toBeVisible();
  await expect(page.getByRole('button', { name: /开始梳理/ })).toHaveCount(0);
  await expect(page.locator('.workspace, .ws-grid')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test('注册支持中文大小写敏感用户名和任意非空密码且恢复码只显示到确认保存', async ({ page }) => {
  const username = '界面注册A';
  const password = '短';
  await page.goto('/');
  await page.getByRole('button', { name: '注册账号' }).click();
  await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  await expect(page.getByText('用户名支持中文并区分大小写；用户名和密码均无应用级长度限制。'))
    .toBeVisible();

  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill('Different-Horse-2026');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.auth-error')).toContainText('两次输入的密码不一致');
  await expect(page.getByText('请立即保存恢复码')).toHaveCount(0);

  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByRole('heading', { name: '请立即保存恢复码' })).toBeVisible();
  const recoveryCode = await page.locator('#recovery-code').innerText();
  expect(recoveryCode).toMatch(/^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  await expect(page.getByText('恢复码只显示这一次')).toBeVisible();

  await page.getByRole('button', { name: '我已保存恢复码' }).click();
  await expect(page.getByRole('heading', { name: '登录时间管理助手' })).toBeVisible();
  await expect(page.locator('#recovery-code')).toHaveCount(0);
  const persisted = await page.evaluate(() => ({
    url: location.href,
    local: { ...localStorage },
    session: { ...sessionStorage },
    hiddenValues: [...document.querySelectorAll('input[type="hidden"]')].map(input => input.value),
  }));
  const serialized = JSON.stringify(persisted);
  expect(serialized).not.toContain(password);
  expect(serialized).not.toContain(recoveryCode);
  const localState = await page.evaluate(async () => {
    const { state } = await import('/state.js');
    return { recoveryCode: state.recoveryCode, csrfToken: state.csrfToken };
  });
  expect(localState.recoveryCode).toBeNull();
  expect(localState.csrfToken).not.toBeNull();
});

test('账号凭据、Session 和业务正文不进入浏览器持久存储', async ({ page, context }) => {
  const username = 'Ui_Storage_Audit_01';
  const password = 'Ui-Storage-Secret-2026';
  const goalMarker = 'PRIVATE_BROWSER_GOAL_STORAGE_MARKER';
  const historyMarker = 'PRIVATE_BROWSER_HISTORY_STORAGE_MARKER';
  const recoveryCode = await registerAndLogin(page, username, password);
  const snapshot = historySnapshot(
    historyMarker,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  );
  snapshot.goals = { ...snapshot.goals, 今天: goalMarker };
  expect((await saveThroughApi(page, snapshot)).status).toBe(201);

  const sessionCookie = (await context.cookies()).find(cookie => cookie.name === 'time.sid');
  expect(sessionCookie).toBeDefined();
  expect(sessionCookie.httpOnly).toBe(true);
  const persisted = await page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    visibleCookie: document.cookie,
    indexedDatabases: typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map(database => database.name)
      : [],
    hiddenValues: [...document.querySelectorAll('input[type="hidden"]')]
      .map(input => input.value),
  }));
  const serialized = JSON.stringify(persisted);
  for (const marker of [
    username,
    password,
    recoveryCode,
    sessionCookie.value,
    goalMarker,
    historyMarker,
  ]) {
    expect(serialized).not.toContain(marker);
  }
  expect(persisted.visibleCookie).not.toContain('time.sid');
  expect(persisted.indexedDatabases).toEqual([]);
});

test('登录后刷新恢复身份但不恢复草稿，退出后回到登录页', async ({ page }) => {
  const username = 'Ui_Login_Refresh_01';
  await page.goto('/');
  await registerThroughApi(page, username);
  await page.reload();

  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(`已登录：${username}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /开始梳理/ })).toBeVisible();

  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#g-今').fill('这是一条不应跨刷新恢复的草稿');
  await page.reload();
  await expect(page.getByText(`已登录：${username}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /开始梳理/ })).toBeVisible();
  await expect(page.locator('#g-今')).toHaveCount(0);
  const stateAfterReload = await page.evaluate(async () => {
    const { state } = await import('/state.js');
    return { user: state.user, goals: state.goals, screen: state.screen };
  });
  expect(stateAfterReload.user.username).toBe(username);
  expect(stateAfterReload.goals).toEqual({ 昨天: '', 今天: '', 明天: '', 后天: '' });
  expect(stateAfterReload.screen).toBe('home');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录时间管理助手' })).toBeVisible();
  await expect(page.getByText(`已登录：${username}`)).toHaveCount(0);
  const me = await page.evaluate(() => fetch('/api/auth/me').then(response => response.status));
  expect(me).toBe(401);
});

test('注册登录后完成四步会先显示报告再自动保存并可查看只读历史详情', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copiedHistory = text; } },
    });
  });
  await registerAndLogin(page, 'Ui_Full_History_01');
  await installWorkflowMocks(page);

  let releaseSave;
  let markSaveStarted;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const saveStarted = new Promise(resolve => { markSaveStarted = resolve; });
  await page.route('**/api/time-management/history', async route => {
    if (route.request().method() === 'POST') {
      markSaveStarted();
      await saveGate;
    }
    await route.continue();
  });

  await completeWorkflow(page);
  await saveStarted;
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');
  await expect(page.locator('#report-markdown')).toContainText('提交方案');
  await expect(page.locator('.history-save-status')).toContainText('正在保存历史');
  releaseSave();
  await expect(page.locator('.history-save-status')).toContainText('历史已保存');

  await openHistory(page);
  await expect(page.getByRole('heading', { name: '历史记录' })).toBeVisible();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.getByRole('heading', { name: /时间管理报告/ })).toBeVisible();
  await expect(page.locator('.history-detail')).toContainText('提交方案');
  await expect(page.locator('.history-detail')).toContainText('方案已提交');
  const visible = await page.locator('.history-detail').innerText();
  for (const id of TASK_IDS) {
    expect(visible).not.toContain(id);
    expect(visible.toLowerCase()).not.toContain(id.slice(0, 8).toLowerCase());
  }
  await page.getByRole('button', { name: '复制历史报告' }).click();
  const copied = await page.evaluate(() => window.__copiedHistory);
  for (const id of TASK_IDS) {
    expect(copied).not.toContain(id);
    expect(copied.toLowerCase()).not.toContain(id.slice(0, 8).toLowerCase());
  }
  await expect(page.getByRole('button', { name: /编辑|继续执行/ })).toHaveCount(0);
});

test('历史保存失败保留报告并使用同一 clientRunId 重试且不重复', async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndLogin(page, 'Ui_History_Retry_01');
  await installWorkflowMocks(page);
  const requests = [];
  let attempts = 0;
  await page.route('**/api/time-management/history', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts += 1;
    requests.push(route.request().postDataJSON());
    if (attempts === 1) return route.abort('failed');
    return route.continue();
  });

  await completeWorkflow(page);
  await expect(page.locator('#report-markdown')).toContainText('提交方案');
  await expect(page.locator('.history-save-status')).toContainText('报告已生成，但历史保存失败');
  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.locator('.history-save-status')).toContainText('历史已保存');
  expect(requests).toHaveLength(2);
  expect(requests[1].clientRunId).toBe(requests[0].clientRunId);

  await openHistory(page);
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('两个用户的历史列表互相隔离', async ({ browser }) => {
  test.setTimeout(60_000);
  const firstContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await registerAndLogin(first, 'Ui_Isolation_A');
    await registerAndLogin(second, 'Ui_Isolation_B');
    expect((await saveThroughApi(first, historySnapshot(
      '用户 A 的时间管理报告',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ))).status).toBe(201);
    expect((await saveThroughApi(second, historySnapshot(
      '用户 B 的时间管理报告',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ))).status).toBe(201);

    await openHistory(first);
    await openHistory(second);
    await expect(first.locator('.history-list')).toContainText('用户 A 的时间管理报告');
    await expect(first.locator('.history-list')).not.toContainText('用户 B 的时间管理报告');
    await expect(second.locator('.history-list')).toContainText('用户 B 的时间管理报告');
    await expect(second.locator('.history-list')).not.toContainText('用户 A 的时间管理报告');
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test('删除历史需要二次确认且只删除目标记录', async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndLogin(page, 'Ui_Delete_History_01');
  expect((await saveThroughApi(page, historySnapshot(
    '待删除的时间管理报告',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ))).status).toBe(201);
  await openHistory(page);
  await expect(page.locator('.history-item')).toHaveCount(1);

  await page.evaluate(() => {
    window.__deleteConfirmations = [];
    window.confirm = message => {
      window.__deleteConfirmations.push(message);
      return false;
    };
  });
  await page.getByRole('button', { name: '删除历史' }).click();
  await expect(page.locator('.history-item')).toHaveCount(1);

  await page.evaluate(() => {
    window.confirm = message => {
      window.__deleteConfirmations.push(message);
      return true;
    };
  });
  await page.getByRole('button', { name: '删除历史' }).click();
  await expect(page.locator('.history-item')).toHaveCount(0);
  expect(await page.evaluate(() => window.__deleteConfirmations)).toEqual([
    '确定删除这条历史记录吗？',
    '确定删除这条历史记录吗？',
  ]);
});

test('恢复码重置撤销旧 Session，新恢复码只显示一次且新密码登录后历史保留', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const username = 'Ui_Recovery_History_01';
  const oldRecoveryCode = await registerAndLogin(page, username);
  expect((await saveThroughApi(page, historySnapshot(
    '重置后仍需保留的报告',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ))).status).toBe(201);

  const oldContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const oldSession = await oldContext.newPage();
  try {
    await loginExisting(oldSession, username);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByRole('button', { name: '忘记密码' }).click();
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('恢复码').fill(oldRecoveryCode);
    await page.getByLabel('新密码', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('确认新密码').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: '重置密码' }).click();
    await expect(page.getByRole('heading', { name: '请立即保存恢复码' })).toBeVisible();
    const newRecoveryCode = await page.locator('#recovery-code').innerText();
    expect(newRecoveryCode).not.toBe(oldRecoveryCode);

    expect(await oldSession.evaluate(() => fetch('/api/auth/me').then(response => response.status)))
      .toBe(401);
    await oldSession.reload();
    await expect(oldSession.getByRole('heading', { name: '登录时间管理助手' })).toBeVisible();

    await page.getByRole('button', { name: '我已保存恢复码' }).click();
    await expect(page.locator('#recovery-code')).toHaveCount(0);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.locator('.auth-error')).toContainText('用户名或密码不正确');
    await page.getByLabel('密码', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await openHistory(page);
    await expect(page.locator('.history-list')).toContainText('重置后仍需保留的报告');
  } finally {
    await oldContext.close();
  }
});

test('移动端登录顶栏保留历史和退出入口且不拥挤换行', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAndLogin(page, 'Ui_Mobile_Header_01');
  await expect(page.locator('#auth-user')).toBeHidden();
  await expect(page.getByRole('button', { name: '历史记录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  const layout = await page.evaluate(() => {
    const brand = document.querySelector('.brand').getBoundingClientRect();
    const history = document.querySelector('#auth-history').getBoundingClientRect();
    const logout = document.querySelector('#auth-logout').getBoundingClientRect();
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    return {
      ordered: brand.right <= history.left && history.right <= logout.left,
      topbarHeight: topbar.height,
      historySingleLine: history.height < 40,
      logoutSingleLine: logout.height < 40,
    };
  });
  expect(layout.ordered).toBe(true);
  expect(layout.topbarHeight).toBeLessThanOrEqual(62);
  expect(layout.historySingleLine).toBe(true);
  expect(layout.logoutSingleLine).toBe(true);
});

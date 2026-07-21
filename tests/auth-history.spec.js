const { expect, test } = require('@playwright/test');

const PASSWORD = 'Ui-History-Horse-2026';

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

test('未登录显示登录页且不能进入工作区', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '登录时间管理助手' })).toBeVisible();
  await expect(page.getByRole('button', { name: /开始梳理/ })).toHaveCount(0);
  await expect(page.locator('.workspace, .ws-grid')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test('注册验证确认密码且恢复码只显示到用户确认保存', async ({ page }) => {
  const username = 'Ui_Register_01';
  await page.goto('/');
  await page.getByRole('button', { name: '注册账号' }).click();
  await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();

  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByLabel('确认密码').fill('Different-Horse-2026');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.auth-error')).toContainText('两次输入的密码不一致');
  await expect(page.getByText('请立即保存恢复码')).toHaveCount(0);

  await page.getByLabel('确认密码').fill(PASSWORD);
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
  expect(serialized).not.toContain(PASSWORD);
  expect(serialized).not.toContain(recoveryCode);
  const localState = await page.evaluate(async () => {
    const { state } = await import('/state.js');
    return { recoveryCode: state.recoveryCode, csrfToken: state.csrfToken };
  });
  expect(localState.recoveryCode).toBeNull();
  expect(localState.csrfToken).not.toBeNull();
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

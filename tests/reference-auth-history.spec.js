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

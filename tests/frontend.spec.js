const { test, expect } = require('@playwright/test');

const MOCK_TASKS = [
  { id: 'task-1', name: '**校对今天的方案终稿**', importance: '低', urgency: '高', source: '今天', due: '今天 18:00', est: '约1h', status: 'pending', classificationSource: 'ai-extraction' },
  { id: 'task-2', name: '跟进两个客户投诉', importance: '高', urgency: '高', source: '临时', due: '今天', est: '约1.5h', status: 'pending', classificationSource: 'ai-extraction' },
  { id: 'task-3', name: '复盘上季度转化缺口原因', importance: '高', urgency: '中', source: '复盘', due: '本周五', est: '约2h', status: 'pending', classificationSource: 'ai-extraction' },
  { id: 'task-4', name: '推进本月选题策划', importance: '高', urgency: '低', source: '短期目标', due: '本月', est: '约3h', status: 'pending', classificationSource: 'ai-extraction' },
  { id: 'task-5', name: '搭建团队分层培养框架', importance: '高', urgency: '低', source: '中长期', due: 'Q3', est: '约4h', status: 'pending', classificationSource: 'ai-extraction' },
  { id: 'task-6', name: '回复非紧急群消息', importance: '低', urgency: '低', source: '临时', due: '待确认', est: '约0.5h', status: 'pending', classificationSource: 'ai-extraction' },
];

function matrixPayload(tasks) {
  const classifications = tasks.map(item => ({
    taskId: item.id,
    importance: item.importance || '低',
    urgency: item.urgency || '低',
    classificationSource: item.classificationSource === 'unclassified'
      ? 'ai-matrix'
      : item.classificationSource,
  }));
  const taskIds = name => classifications
    .filter(item => {
      const important = item.importance === '高';
      const urgent = item.urgency === '高';
      return (name === '第一象限' && important && urgent)
        || (name === '第二象限' && important && !urgent)
        || (name === '第三象限' && !important && urgent)
        || (name === '第四象限' && !important && !urgent);
    })
    .map(item => item.taskId);
  return {
    classifications,
    quadrants: [
      { name: '第一象限', priority: 1, action: '立即做', energyPercent: 55, taskIds: taskIds('第一象限') },
      { name: '第二象限', priority: 2, action: '计划做', energyPercent: 25, taskIds: taskIds('第二象限') },
      { name: '第三象限', priority: 3, action: '授权做', energyPercent: 15, taskIds: taskIds('第三象限') },
      { name: '第四象限', priority: 4, action: '减少做', energyPercent: 5, taskIds: taskIds('第四象限') },
    ],
    note: '',
  };
}

async function installWorkflowMocks(page, { onMatrix } = {}) {
  await page.route('**/api/time-management/goals/check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      fields: ['昨天', '今天', '明天', '后天'].map(key => ({
        key,
        status: 'ok',
        issue: '',
        suggestion: '',
      })),
      overall: 'pass',
    }),
  }));
  await page.route('**/api/time-management/tasks/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tasks: MOCK_TASKS }),
  }));
  await page.route('**/api/time-management/matrix/classify', async route => {
    const body = route.request().postDataJSON();
    onMatrix?.(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(matrixPayload(body.tasks)),
    });
  });
  await page.route('**/api/time-management/report/generate', async route => {
    const body = route.request().postDataJSON();
    const order = body.tasks.slice(0, 3).map(item => ({
      taskId: item.id,
      reason: '该任务是当前的优先事项',
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        order,
        energyRules: ['为第二象限预留整块时间', '压缩第四象限的零散事项'],
        adjustments: ['每周固定一次复盘', '在 12 月 31 日前完成 3 个里程碑'],
      }),
    });
  });
}

async function completeGoalCheck(page, mockOptions) {
  await installWorkflowMocks(page, mockOptions);
  await page.locator('#g-昨').fill('原定完成季度复盘，实际已完成初稿，差距是缺少数据，下一步补齐数据并复核。');
  await page.locator('#g-今').fill('整理客户反馈清单并在今天下班前确认三项最高优先问题。');
  await page.locator('#g-明').fill('本周五前完成方案初稿并覆盖三个明确的业务场景。');
  await page.locator('#g-后').fill('本季度末完成团队流程梳理并形成可评审的第一版手册。');
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();
  await expect(page.locator('.field-fb.ok')).toHaveCount(4);
}

async function advanceToMatrix(page, mockOptions) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await completeGoalCheck(page, mockOptions);
  await page.getByRole('button', { name: /提取任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('任务提取');
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('矩阵判定');
}

async function advanceToTasks(page, mockOptions) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await completeGoalCheck(page, mockOptions);
  await page.getByRole('button', { name: /提取任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('任务提取');
}

async function mountMarkdownFixture(page, markdown) {
  await page.goto('/');
  await page.evaluate((source) => {
    const fixture = document.createElement('section');
    fixture.id = 'markdown-fixture';
    document.body.appendChild(fixture);
    window.renderMarkdown(fixture, source);
  }, markdown);
}

test('模型 Markdown 会完整渲染为标题、列表、表格与代码块', async ({ page }) => {
  await mountMarkdownFixture(page, [
    '# 今日行动',
    '',
    '**优先处理** `客户投诉`',
    '',
    '~~已完成~~',
    '',
    '- 第一步',
    '- 第二步',
    '',
    '> 一周后复盘',
    '',
    '| 事项 | 状态 |',
    '| --- | --- |',
    '| 方案 | 进行中 |',
    '',
    '```json',
    '{"ok": true}',
    '```',
  ].join('\n'));

  const fixture = page.locator('#markdown-fixture');
  await expect(fixture).toHaveClass(/markdown-body/);
  await expect(fixture.locator('h1')).toHaveText('今日行动');
  await expect(fixture.locator('strong')).toHaveText('优先处理');
  await expect(fixture.locator('s')).toHaveText('已完成');
  await expect(fixture.locator('ul > li')).toHaveCount(2);
  await expect(fixture.locator('blockquote')).toContainText('一周后复盘');
  await expect(fixture.locator('table th')).toHaveText(['事项', '状态']);
  await expect(fixture.locator('pre code')).toContainText('{"ok": true}');
  await expect(fixture).not.toContainText('**优先处理**');
});

test('Markdown 渲染会转义原始 HTML 并拦截危险链接', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__markdownXss = false;
    const fixture = document.createElement('section');
    fixture.id = 'markdown-fixture';
    document.body.appendChild(fixture);
    window.renderMarkdown(fixture, [
      '<img data-markdown-xss="1" src="x" onerror="window.__markdownXss=true">',
      '',
      '<svg data-svg-xss="1" onload="window.__markdownXss=true"></svg>',
      '',
      '<iframe data-frame-xss="1" srcdoc="<script>window.__markdownXss=true</script>"></iframe>',
      '',
      '[危险链接](javascript:window.__markdownXss=true)',
      '',
      '[混合大小写](JaVaScRiPt:window.__markdownXss=true)',
      '',
      '[实体混淆](java&#x73;cript:window.__markdownXss=true)',
      '',
      '[数据链接](data:text/html,unsafe)',
      '',
      '[协议相对链接](//attacker.invalid/path)',
      '',
      '[安全链接](https://example.com/guide)',
      '',
      '![远程追踪图](https://attacker.invalid/pixel.png)',
    ].join('\n'));
  });

  const fixture = page.locator('#markdown-fixture');
  await expect(fixture.locator('[data-markdown-xss]')).toHaveCount(0);
  await expect(fixture.locator('[data-svg-xss], [data-frame-xss], svg, iframe')).toHaveCount(0);
  await expect(fixture.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(fixture.locator('a')).toHaveCount(1);
  await expect(fixture.locator('img, [src]')).toHaveCount(0);
  await expect(fixture.locator('.markdown-image')).toContainText('远程追踪图');
  await expect(fixture).toContainText('<img data-markdown-xss="1"');
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('href', 'https://example.com/guide');
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('target', '_blank');
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('rel', /noopener.*noreferrer.*nofollow/);
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await page.evaluate(() => window.__markdownXss)).toBe(false);
});

test('Markdown 重复渲染会替换旧内容且空值不会显示 undefined', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'markdown-fixture';
    document.body.appendChild(fixture);
    window.renderMarkdown(fixture, '# 第一版');
    window.renderMarkdown(fixture, '**第二版**');
  });

  const fixture = page.locator('#markdown-fixture');
  await expect(fixture.locator('h1')).toHaveCount(0);
  await expect(fixture.locator('strong')).toHaveText('第二版');
  await page.evaluate(() => window.renderMarkdown(document.getElementById('markdown-fixture'), null));
  await expect(fixture).toBeEmpty();
});

test('窄屏下长代码块只在自身横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await mountMarkdownFixture(page, `\`\`\`text\n${'x'.repeat(320)}\n\`\`\``);

  const overflow = await page.evaluate(() => {
    const code = document.querySelector('#markdown-fixture pre');
    return {
      codeScrollable: code.scrollWidth > code.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(overflow).toEqual({ codeScrollable: true, pageOverflow: false });
});

test('优先级报告的模型正文通过 Markdown 渲染器展示', async ({ page }) => {
  await advanceToMatrix(page);
  await page.getByRole('button', { name: /生成报告/ }).click();

  const report = page.locator('#report-markdown.markdown-body');
  await expect(report.locator('h2')).toHaveCount(3);
  await expect(report.locator('ul > li')).toHaveCount(7);
  await expect(report).not.toContainText('## 今日优先处理顺序');
});

test('窄屏优先级报告不会产生整页横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await advanceToMatrix(page);
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});

test('模型任务名使用行内 Markdown 且不露出标记', async ({ page }) => {
  await advanceToTasks(page);

  const firstTask = page.locator('#tasklist .task').first();
  await expect(firstTask.locator('.task-name strong')).toHaveText('校对今天的方案终稿');
  await expect(firstTask.locator('.task-name')).not.toContainText('**校对今天的方案终稿**');
});

test('未完成目标检查时不能进入任务提取', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();

  await page.getByRole('button', { name: /提取任务/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('目标梳理');
  await expect(page.locator('#toast')).toContainText('先完成');
});

test('返回目标页会保留输入且修改后必须重新检查', async ({ page }) => {
  await advanceToTasks(page);

  await page.getByRole('button', { name: '上一步' }).click();

  await expect(page.locator('#g-昨')).toHaveValue(/原定完成季度复盘/);
  await page.locator('#g-昨').fill('');
  await page.locator('.step').filter({ hasText: '任务提取' }).click();
  await expect(page.locator('.panel-h')).toHaveText('目标梳理');
});

test('目标检查过程中离开页面不会批准新的空白流程', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();
  await page.locator('.brand').click();
  await page.waitForTimeout(1_400);
  await page.getByRole('button', { name: /开始梳理/ }).click();

  await page.getByRole('button', { name: /提取任务/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('目标梳理');
});

test('处理动画中返回首页不会被旧定时器带回工作区', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await completeGoalCheck(page);
  await page.getByRole('button', { name: /提取任务/ }).click();
  await page.locator('.brand').click();

  await page.waitForTimeout(3_000);

  await expect(page.locator('.home-h1')).toBeVisible();
  await expect(page.locator('.panel-h')).toHaveCount(0);
});

test('空目标的补全提示不会写入虚构业务事实', async ({ page }) => {
  await page.route('**/api/time-management/goals/check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      fields: ['昨天', '今天', '明天', '后天'].map(key => ({
        key,
        status: 'warn',
        issue: '示范，请按实际修改:当前尚未填写。',
        suggestion: '请补充:目标、结果、原因与下一步改进。',
      })),
      overall: 'need_fix',
    }),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();
  await page.locator('#fb-昨 .adopt').click();

  await expect(page.locator('#g-昨')).not.toHaveValue(/获客目标完成 80%/);
  await expect(page.locator('#g-昨')).toHaveValue(/请补充/);
});

test('手动任务把耗时字段当作文本而不是 HTML', async ({ page }) => {
  await advanceToTasks(page);
  await page.getByRole('button', { name: /手动添加任务/ }).click();
  await page.locator('#f-name').fill('<svg data-name-xss="1"></svg>');
  await page.locator('#f-src').selectOption({ label: '临时' });
  await page.locator('#f-due').fill('2026-07-17');
  await page.locator('#f-cost').fill('<img data-xss="1" src="x">');

  await page.getByRole('button', { name: /添加到列表/ }).click();

  await expect(page.locator('.task.manual [data-name-xss]')).toHaveCount(0);
  await expect(page.locator('.task.manual [data-xss]')).toHaveCount(0);
  await expect(page.locator('.task.manual .task-name')).toContainText('<svg data-name-xss="1"></svg>');
  await expect(page.locator('.task.manual .tags')).toContainText('<img data-xss="1" src="x">');
});

test('矩阵按左侧不紧急、右侧紧急排列四个象限', async ({ page }) => {
  await advanceToMatrix(page);

  const quadrantOrder = await page.locator('.matrix .quad').evaluateAll((nodes) =>
    nodes.map((node) => [...node.classList].find((name) => /^q[1-4]$/.test(name))),
  );
  const horizontalAxis = await page.locator('.axis-x span').allTextContents();
  const verticalAxis = await page.locator('.axis-y span').allTextContents();

  expect(quadrantOrder).toEqual(['q2', 'q1', 'q4', 'q3']);
  expect(horizontalAxis).toEqual(['不紧急', '紧急']);
  expect(verticalAxis).toEqual(['重要', '不重要']);
});

test('复制报告会把当前报告正文写入剪贴板', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        },
      },
    });
  });
  await advanceToMatrix(page);
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');

  await page.getByRole('button', { name: /复制报告/ }).click();

  await expect.poll(() => page.evaluate(() => window.__copiedText || ''))
    .toContain('今日优先处理顺序');
  await expect.poll(() => page.evaluate(() => window.__copiedText || ''))
    .toContain('精力分配原则');
});

test('目标修改后必须重新检查才能提取任务', async ({ page }) => {
  await page.route('**/api/time-management/goals/check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      fields: ['昨天', '今天', '明天', '后天'].map(key => ({
        key,
        status: 'ok',
        issue: '',
        suggestion: '',
      })),
      overall: 'pass',
    }),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#g-昨').fill('目标、结果、原因和改进均已记录');
  await page.locator('#g-今').fill('提交今日方案');
  await page.locator('#g-明').fill('7月31日前提交1份计划');
  await page.locator('#g-后').fill('12月31日前完成年度目标');
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();
  await expect(page.locator('.field-fb.ok')).toHaveCount(4);
  await page.locator('#g-今').fill('提交修改后的今日方案');
  await page.getByRole('button', { name: /提取任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('目标梳理');
  await expect(page.locator('#toast')).toContainText('先完成');
});

test('新增或删除任务后必须重新判定矩阵', async ({ page }) => {
  let matrixCalls = 0;
  await advanceToMatrix(page, { onMatrix: () => { matrixCalls += 1; } });
  await page.getByRole('button', { name: '上一步' }).click();
  await page.locator('#tasklist .task-del').first().click();
  await page.locator('.step').filter({ hasText: '矩阵判定' }).click();
  await expect(page.locator('.panel-h')).toHaveText('任务提取');
  await expect(page.locator('#toast')).toContainText('重新判定');
  expect(matrixCalls).toBe(1);

  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('矩阵判定');
  expect(matrixCalls).toBe(2);
  await page.getByRole('button', { name: '上一步' }).click();
  await page.getByRole('button', { name: /手动添加任务/ }).click();
  await page.locator('#f-name').fill('新增临时任务');
  await page.locator('#f-src').selectOption({ label: '临时' });
  await page.locator('#f-due').fill('2026-07-20');
  await page.locator('#f-cost').fill('1h');
  await page.getByRole('button', { name: /添加到列表/ }).click();
  await page.locator('.step').filter({ hasText: '矩阵判定' }).click();
  await expect(page.locator('.panel-h')).toHaveText('任务提取');
  await expect(page.locator('#toast')).toContainText('重新判定');
  expect(matrixCalls).toBe(2);
});

test('重新梳理会取消请求并清空全部流程状态', async ({ page }) => {
  await page.addInitScript(() => {
    const abort = AbortController.prototype.abort;
    window.__abortCount = 0;
    AbortController.prototype.abort = function instrumentedAbort(...args) {
      window.__abortCount += 1;
      return abort.apply(this, args);
    };
  });
  await advanceToMatrix(page);
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');
  const before = await page.evaluate(() => window.__abortCount);

  await page.getByRole('button', { name: /重新梳理/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('目标梳理');
  expect(await page.locator('textarea[id^="g-"]').evaluateAll(nodes =>
    nodes.map(node => node.value))).toEqual(['', '', '', '']);
  const snapshot = await page.evaluate(async () => {
    const { state } = await import('/state.js');
    return {
      goals: state.goals,
      tasks: state.tasks,
      matrix: state.matrix,
      report: state.report,
      abortCount: window.__abortCount,
    };
  });
  expect(snapshot.goals).toEqual({ 昨天: '', 今天: '', 明天: '', 后天: '' });
  expect(snapshot.tasks).toEqual([]);
  expect(snapshot.matrix).toBeNull();
  expect(snapshot.report).toBeNull();
  expect(snapshot.abortCount).toBeGreaterThan(before);
});

test('未修改数据时返回上一步再前进保留原结果', async ({ page }) => {
  let matrixCalls = 0;
  await advanceToMatrix(page, { onMatrix: () => { matrixCalls += 1; } });
  const before = await page.locator('.matrix .qtask').allTextContents();
  await page.getByRole('button', { name: '上一步' }).click();
  await page.locator('.step').filter({ hasText: '矩阵判定' }).click();

  await expect(page.locator('.panel-h')).toHaveText('矩阵判定');
  expect(await page.locator('.matrix .qtask').allTextContents()).toEqual(before);
  expect(matrixCalls).toBe(1);
});

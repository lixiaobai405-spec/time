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

async function installWorkflowMocks(page, {
  onGoals,
  onExtract,
  onMatrix,
  onReport,
  extractTasks = MOCK_TASKS,
} = {}) {
  await page.route('**/api/time-management/goals/check', async route => {
    onGoals?.(route.request().postDataJSON());
    await route.fulfill({
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
    });
  });
  await page.route('**/api/time-management/tasks/extract', async route => {
    onExtract?.(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: extractTasks }),
    });
  });
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
    onReport?.(body);
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

test('任务卡安全展示完成标准且手动任务流程保持可用', async ({ page }) => {
  await page.addInitScript(() => { window.__criteriaXss = false; });
  const criteria = [
    '形成 4 个模块',
    '完成 2 次模拟',
    '<img src=x onerror="window.__criteriaXss=true">评分不低于 80 分',
  ];
  await advanceToTasks(page, {
    extractTasks: [{
      ...MOCK_TASKS[0],
      name: '完成管理课程训练材料',
      source: '短期目标',
      acceptanceCriteria: criteria,
    }],
  });

  const smartTask = page.locator('.task').filter({ hasText: '完成管理课程训练材料' });
  await expect(smartTask).toContainText('完成标准');
  await expect(smartTask.locator('.acceptance-criteria li')).toHaveText(criteria);
  await expect(smartTask.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__criteriaXss)).toBe(false);

  await page.getByRole('button', { name: /手动添加任务/ }).click();
  await page.locator('#f-name').fill('手动补充任务');
  await page.locator('#f-src').selectOption({ label: '临时' });
  await page.locator('#f-due').fill('2026-08-01');
  await page.locator('#f-cost').fill('1h');
  await page.getByRole('button', { name: /添加到列表/ }).click();
  await expect(page.locator('.task').filter({ hasText: '手动补充任务' })).toBeVisible();
});

test('长期任务卡展示下一步且普通任务不显示空区域', async ({ page }) => {
  await advanceToTasks(page, {
    extractTasks: [
      {
        ...MOCK_TASKS[0],
        name: '推进长期课程里程碑',
        source: '中长期',
        est: '16h',
        acceptanceCriteria: ['完成第一阶段里程碑'],
        nextAction: '今天先列出 4 个课程模块',
      },
      {
        ...MOCK_TASKS[1],
        name: '发送今天的会议纪要',
        nextAction: '',
      },
    ],
  });

  const longTermTask = page.locator('.task').filter({ hasText: '推进长期课程里程碑' });
  await expect(longTermTask).toContainText('下一步');
  await expect(longTermTask.locator('.next-action')).toContainText('今天先列出 4 个课程模块');
  const ordinaryTask = page.locator('.task').filter({ hasText: '发送今天的会议纪要' });
  await expect(ordinaryTask.locator('.next-action')).toHaveCount(0);
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

test('矩阵方向按左侧不紧急、右侧紧急排列四个象限', async ({ page }) => {
  await advanceToMatrix(page);

  const quadrantOrder = await page.locator('.matrix .quad').evaluateAll((nodes) =>
    nodes.map((node) => [...node.classList].find((name) => /^q[1-4]$/.test(name))),
  );
  const horizontalAxis = await page.locator('.axis-x span').allTextContents();
  const verticalAxis = await page.locator('.axis-y span').allTextContents();

  expect(quadrantOrder).toEqual(['q2', 'q1', 'q4', 'q3']);
  expect(horizontalAxis).toEqual(['不紧急', '紧急']);
  expect(verticalAxis).toEqual(['重要', '不重要']);

  const verticalLabels = page.locator('.axis-y span');
  const topBox = await verticalLabels.nth(0).boundingBox();
  const bottomBox = await verticalLabels.nth(1).boundingBox();
  expect(topBox.y).toBeLessThan(bottomBox.y);
  const verticalStyles = await verticalLabels.evaluateAll(nodes => nodes.map((node) => {
    const style = getComputedStyle(node);
    return { writingMode: style.writingMode, textOrientation: style.textOrientation };
  }));
  expect(verticalStyles).toEqual([
    { writingMode: 'vertical-rl', textOrientation: 'upright' },
    { writingMode: 'vertical-rl', textOrientation: 'upright' },
  ]);
  expect(await page.locator('.axis-y').evaluate(node => getComputedStyle(node).transform))
    .toBe('none');
});

test('375px 窄屏纵轴文字完整且不与矩阵卡片重叠', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await advanceToMatrix(page);

  const layout = await page.evaluate(() => {
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const wrap = rect(document.querySelector('.matrix-wrap'));
    const labels = [...document.querySelectorAll('.axis-y span')].map(rect);
    const quadrants = [...document.querySelectorAll('.matrix .quad')].map(rect);
    const intersects = (a, b) => (
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    );
    return {
      wrap,
      labels,
      overlaps: labels.map(label => quadrants.some(quad => intersects(label, quad))),
    };
  });

  for (const label of layout.labels) {
    expect(label.left).toBeGreaterThanOrEqual(layout.wrap.left);
    expect(label.right).toBeLessThanOrEqual(layout.wrap.right);
    expect(label.top).toBeGreaterThanOrEqual(layout.wrap.top);
    expect(label.bottom).toBeLessThanOrEqual(layout.wrap.bottom);
  }
  expect(layout.overlaps).toEqual([false, false]);
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

test('内部任务 ID 只用于结构化关联且不会进入报告页面或复制内容', async ({ page }) => {
  const id = '9a38e8c3-1111-4111-8111-111111111111';
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => { window.__copiedText = text; },
      },
    });
  });
  await advanceToMatrix(page, {
    extractTasks: [{
      ...MOCK_TASKS[0],
      id,
      name: '完成客户方案',
    }],
  });
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');
  await expect(page.locator('#report-markdown')).not.toContainText(id);
  await expect(page.locator('#report-markdown')).not.toContainText(id.slice(0, 8));

  await page.getByRole('button', { name: /复制报告/ }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedText || '')).not.toContain(id);
  await expect.poll(() => page.evaluate(() => window.__copiedText || '')).not.toContain(id.slice(0, 8));
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

test('四个 API 请求使用用户当前输入和编辑后任务', async ({ page }) => {
  const seen = {};
  await advanceToTasks(page, {
    onGoals: body => { seen.goals = body; },
    onExtract: body => { seen.extract = body; },
    onMatrix: body => { seen.matrix = body; },
    onReport: body => { seen.report = body; },
  });
  await page.getByRole('button', { name: /手动添加任务/ }).click();
  await page.locator('#f-name').fill('用户刚添加的任务');
  await page.locator('#f-src').selectOption({ label: '临时' });
  await page.locator('#f-due').fill('2026-08-01');
  await page.locator('#f-cost').fill('45分钟');
  await page.getByRole('button', { name: /添加到列表/ }).click();
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('矩阵判定');
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');

  expect(seen.goals.goals.今天).toContain('客户反馈');
  expect(seen.extract).toEqual(seen.goals);
  const manual = seen.matrix.tasks.find(item => item.name === '用户刚添加的任务');
  expect(manual).toMatchObject({
    importance: null,
    urgency: null,
    classificationSource: 'unclassified',
    due: '2026-08-01',
  });
  expect(seen.report.tasks.find(item => item.id === manual.id)).toMatchObject({
    importance: '低',
    urgency: '低',
    classificationSource: 'ai-matrix',
  });
  expect(seen.report.matrix.quadrants).toHaveLength(4);
  expect(seen.report.goals).toEqual(seen.goals.goals);
});

test('overall=need_fix 时阻止提取且只在对应输入框下展示建议', async ({ page }) => {
  let extractCalls = 0;
  await installWorkflowMocks(page, { onExtract: () => { extractCalls += 1; } });
  await page.route('**/api/time-management/goals/check', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      fields: [
        { key: '昨天', status: 'warn', issue: '缺少原因', suggestion: '补充差距原因' },
        ...['今天', '明天', '后天'].map(key => ({ key, status: 'ok', issue: '', suggestion: '' })),
      ],
      overall: 'need_fix',
    }),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  for (const id of ['昨', '今', '明', '后']) await page.locator(`#g-${id}`).fill('当前用户输入');
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();

  await expect(page.locator('#fb-昨')).toContainText('缺少原因');
  await expect(page.locator('#fb-昨')).toContainText('补充差距原因');
  await expect(page.getByRole('button', { name: '采纳建议' })).toHaveCount(1);
  await expect(page.locator('[class*="chat"]')).toHaveCount(0);
  await page.getByRole('button', { name: /提取任务/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('目标梳理');
  expect(extractCalls).toBe(0);
});

test('未标注手动任务在矩阵前后分别显示待 AI 判定和 AI 判定', async ({ page }) => {
  await advanceToTasks(page);
  await page.getByRole('button', { name: /手动添加任务/ }).click();
  await page.locator('#f-name').fill('待判定任务');
  await page.locator('#f-src').selectOption({ label: '临时' });
  await page.locator('#f-due').fill('2026-08-01');
  await page.locator('#f-cost').fill('1h');
  await page.getByRole('button', { name: /添加到列表/ }).click();
  await expect(page.locator('.task').filter({ hasText: '待判定任务' })).toContainText('待 AI 判定');
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await page.getByRole('button', { name: '上一步' }).click();
  const taskRow = page.locator('.task').filter({ hasText: '待判定任务' });
  await expect(taskRow).toContainText('AI 判定');
  await expect(taskRow).not.toContainText('待 AI 判定');
});

test('矩阵响应修改已有标签时不渲染部分结果', async ({ page }) => {
  await advanceToTasks(page);
  await page.route('**/api/time-management/matrix/classify', async route => {
    const result = matrixPayload(route.request().postDataJSON().tasks);
    result.classifications[0] = { ...result.classifications[0], importance: '高' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.getByRole('button', { name: /矩阵判定/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('任务提取');
  await expect(page.locator('#toast')).toContainText('任务数据已变化');
  await expect(page.locator('.matrix')).toHaveCount(0);
});

test('矩阵响应缺少 taskId 时要求重新判定', async ({ page }) => {
  await advanceToTasks(page);
  await page.route('**/api/time-management/matrix/classify', async route => {
    const result = matrixPayload(route.request().postDataJSON().tasks);
    result.classifications = result.classifications.slice(1);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.getByRole('button', { name: /矩阵判定/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('任务提取');
  await expect(page.locator('#toast')).toContainText('任务数据已变化');
});

test('网络断开时保留当前任务并给出中文重试提示', async ({ page }) => {
  await advanceToTasks(page);
  const before = await page.locator('#tasklist .task').count();
  await page.route('**/api/time-management/matrix/classify', route => route.abort('failed'));
  await page.getByRole('button', { name: /矩阵判定/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('任务提取');
  await expect(page.locator('#tasklist .task')).toHaveCount(before);
  await expect(page.locator('#toast')).toContainText('网络连接');
  await expect(page.getByRole('button', { name: /矩阵判定/ })).toBeVisible();
});

test('报告引用已删除 taskId 时不显示混合旧数据', async ({ page }) => {
  await advanceToMatrix(page);
  await page.route('**/api/time-management/report/generate', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      order: [{ taskId: 'deleted-task', reason: '这是旧任务' }],
      energyRules: ['保留第二象限时间'],
      adjustments: ['每周复盘'],
    }),
  }));
  await page.getByRole('button', { name: /生成报告/ }).click();

  await expect(page.locator('.panel-h')).toHaveText('矩阵判定');
  await expect(page.locator('#toast')).toContainText('重新生成报告');
  await expect(page.locator('#toast')).not.toContainText('deleted-task');
  await expect(page.locator('#report-markdown')).toHaveCount(0);
});

test('输入错误、模型超时和格式错误保留当前步骤供重试', async ({ page }) => {
  await advanceToTasks(page);
  const errors = [
    { status: 400, code: 'INPUT_INVALID', message: '输入内容不符合要求。' },
    { status: 504, code: 'MODEL_TIMEOUT', message: 'AI 响应超时，请重试。' },
    { status: 502, code: 'MODEL_OUTPUT_INVALID', message: 'AI 返回格式异常，请重试。' },
  ];
  let index = 0;
  await page.route('**/api/time-management/matrix/classify', route => {
    const current = errors[index];
    index += 1;
    return route.fulfill({
      status: current.status,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: current.code, message: current.message } }),
    });
  });

  for (const expected of errors) {
    await page.getByRole('button', { name: /矩阵判定/ }).click();
    await expect(page.locator('.panel-h')).toHaveText('任务提取');
    await expect(page.locator('#toast')).toContainText(expected.message);
    await expect(page.getByRole('button', { name: /矩阵判定/ })).toBeVisible();
  }
});

test('目标输入页明确展示会话隐私和敏感信息提示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await expect(page.getByText('你填写的目标和任务仅用于完成本次会话，不会保存为历史记录。')).toBeVisible();
  await expect(page.getByText('请勿填写客户隐私、密码或其他敏感信息。')).toBeVisible();
});

test('用户输入会真实贯穿任务、矩阵和报告', async ({ page }) => {
  const bodies = [];
  await page.route('**/api/time-management/**', async route => {
    const requestPath = new URL(route.request().url()).pathname;
    bodies.push({ path: requestPath, body: route.request().postDataJSON() });
    const responses = {
      '/api/time-management/goals/check': {
        fields: ['昨天', '今天', '明天', '后天'].map(key => ({ key, status: 'ok', issue: '', suggestion: '' })),
        overall: 'pass',
      },
      '/api/time-management/tasks/extract': {
        tasks: [{ id: 'task-1', name: '提交七月经营复盘', importance: '高', urgency: '高', source: '今天', due: '7月31日', est: '约2h', status: 'pending', classificationSource: 'ai-extraction' }],
      },
      '/api/time-management/matrix/classify': {
        classifications: [{ taskId: 'task-1', importance: '高', urgency: '高', classificationSource: 'ai-extraction' }],
        quadrants: [
          { q: '第一象限', priority: 1, action: '立即做', energyPercent: 55, taskIds: ['task-1'] },
          { q: '第二象限', priority: 2, action: '计划做', energyPercent: 25, taskIds: [] },
          { q: '第三象限', priority: 3, action: '授权做', energyPercent: 15, taskIds: [] },
          { q: '第四象限', priority: 4, action: '减少做', energyPercent: 5, taskIds: [] },
        ],
        note: '',
      },
      '/api/time-management/report/generate': {
        order: [{ taskId: 'task-1', reason: '重要且紧急' }],
        energyRules: ['优先完成第一象限'],
        adjustments: ['完成后进行复盘'],
      },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses[requestPath]),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始梳理/ }).click();
  await page.locator('#g-昨').fill('已复盘目标、结果、原因和改进');
  await page.locator('#g-今').fill('提交七月经营复盘');
  await page.locator('#g-明').fill('7月31日前提交1份八月计划');
  await page.locator('#g-后').fill('12月31日前完成年度复盘');
  await page.getByRole('button', { name: /AI 检查并补全/ }).click();
  await page.getByRole('button', { name: /提取任务/ }).click();
  await expect(page.getByText('提交七月经营复盘')).toBeVisible();
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('#report-markdown')).toContainText('重要且紧急');
  expect(bodies).toHaveLength(4);
  expect(bodies[2].body.tasks[0].id).toBe('task-1');
  expect(bodies[3].body.matrix.quadrants[0].taskIds[0]).toBe('task-1');
});

test('窄屏异步步骤完成后新页面标题回到可视区', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await advanceToMatrix(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: /生成报告/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('优先级报告');

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const titleBox = await page.locator('.panel-h').boundingBox();
  const topbarBox = await page.locator('.topbar').boundingBox();
  expect(titleBox.y).toBeGreaterThanOrEqual(topbarBox.height);
  expect(titleBox.y).toBeLessThan(812);
});

test('失败后重试成功会清除旧错误提示', async ({ page }) => {
  await advanceToTasks(page);
  let attempts = 0;
  await page.route('**/api/time-management/matrix/classify', async route => {
    attempts += 1;
    if (attempts === 1) return route.abort('failed');
    const { tasks } = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(matrixPayload(tasks)),
    });
  });
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await expect(page.locator('#toast')).toContainText('网络连接');
  await page.getByRole('button', { name: /矩阵判定/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('矩阵判定');
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
  await expect(page.locator('#toast')).toBeEmpty();
});

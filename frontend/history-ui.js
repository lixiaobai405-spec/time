function actionButton(text, action, className = 'btn btn-ghost btn-sm', historyId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.action = action;
  if (historyId) button.dataset.historyId = historyId;
  button.textContent = text;
  return button;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function screenHeader(title, backAction) {
  const header = document.createElement('div');
  header.className = 'history-header';
  header.appendChild(actionButton('返回', backAction));
  const heading = document.createElement('h1');
  heading.textContent = title;
  header.appendChild(heading);
  return header;
}

export function renderHistoryList({ items, nextCursor, loading, error }) {
  const section = document.createElement('section');
  section.className = 'history-page';
  section.appendChild(screenHeader('历史记录', 'history-home'));
  const intro = document.createElement('p');
  intro.className = 'history-intro';
  intro.textContent = '这里只保存已经完成并生成报告的流程；草稿不会保存。';
  section.appendChild(intro);

  if (error) {
    const message = document.createElement('div');
    message.className = 'history-error';
    message.setAttribute('role', 'alert');
    message.textContent = error;
    section.appendChild(message);
  }

  const list = document.createElement('div');
  list.className = 'history-list';
  for (const item of items) {
    const article = document.createElement('article');
    article.className = 'history-item';
    const content = document.createElement('div');
    content.className = 'history-item-content';
    const title = document.createElement('h2');
    title.textContent = item.title;
    const time = document.createElement('p');
    time.textContent = `生成时间：${formatTimestamp(item.createdAt)}`;
    content.append(title, time);
    const actions = document.createElement('div');
    actions.className = 'history-item-actions';
    actions.append(
      actionButton('查看详情', 'history-detail', 'btn btn-primary btn-sm', item.id),
      actionButton('删除历史', 'history-delete', 'btn btn-ghost btn-sm', item.id),
    );
    article.append(content, actions);
    list.appendChild(article);
  }
  if (items.length === 0 && !loading) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '还没有已完成的历史记录。';
    list.appendChild(empty);
  }
  section.appendChild(list);

  if (loading) {
    const loadingText = document.createElement('div');
    loadingText.className = 'history-loading';
    loadingText.textContent = '正在加载历史记录…';
    section.appendChild(loadingText);
  } else if (nextCursor) {
    section.appendChild(actionButton('加载更多', 'history-more', 'btn btn-ghost history-more'));
  }
  return section;
}

function labelledSection(titleText) {
  const section = document.createElement('section');
  section.className = 'history-section';
  const title = document.createElement('h2');
  title.textContent = titleText;
  section.appendChild(title);
  return section;
}

export function renderHistoryDetail(item) {
  const page = document.createElement('section');
  page.className = 'history-page history-detail';
  page.appendChild(screenHeader(item.title, 'history-back'));
  const meta = document.createElement('p');
  meta.className = 'history-intro';
  meta.textContent = `生成时间：${formatTimestamp(item.createdAt)} · 只读历史`;
  page.appendChild(meta);

  const content = document.createElement('div');
  content.className = 'history-detail-content';
  const goals = labelledSection('目标梳理');
  const goalGrid = document.createElement('div');
  goalGrid.className = 'history-goals';
  for (const [key, value] of Object.entries(item.goals)) {
    const card = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = key;
    const text = document.createElement('p');
    text.textContent = value || '未填写';
    card.append(label, text);
    goalGrid.appendChild(card);
  }
  goals.appendChild(goalGrid);

  const tasks = labelledSection('任务清单');
  const taskList = document.createElement('div');
  taskList.className = 'history-tasks';
  for (const task of item.tasks) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = task.name;
    const metaText = document.createElement('p');
    const metadata = [
      `${task.importance}/${task.urgency}`,
      task.source,
      `截止：${task.due || '待确认'}`,
    ];
    if (task.source !== '中长期' && task.est) metadata.push(task.est);
    if (task.classificationSource === 'ai-matrix') metadata.push('AI 判定');
    metaText.textContent = metadata.join(' · ');
    card.append(title, metaText);
    if (task.acceptanceCriteria.length > 0) {
      const criteriaTitle = document.createElement('strong');
      criteriaTitle.textContent = '完成标准';
      const criteria = document.createElement('ul');
      for (const value of task.acceptanceCriteria) {
        const row = document.createElement('li');
        row.textContent = value;
        criteria.appendChild(row);
      }
      card.append(criteriaTitle, criteria);
    }
    if (task.nextAction) {
      const next = document.createElement('p');
      next.textContent = `下一步：${task.nextAction}`;
      card.appendChild(next);
    }
    taskList.appendChild(card);
  }
  tasks.appendChild(taskList);

  const matrix = labelledSection('重要-紧急矩阵');
  const taskById = new Map(item.tasks.map(task => [task.id, task]));
  const quadrants = document.createElement('div');
  quadrants.className = 'history-quadrants';
  for (const quadrant of item.matrix.quadrants) {
    const card = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${quadrant.name} · ${quadrant.energyPercent}%`;
    const names = document.createElement('p');
    names.textContent = quadrant.taskIds.map(id => taskById.get(id)?.name).filter(Boolean).join('、') || '暂无任务';
    card.append(title, names);
    quadrants.appendChild(card);
  }
  matrix.appendChild(quadrants);

  const report = labelledSection('优先级报告');
  const markdown = document.createElement('div');
  markdown.id = 'history-report-markdown';
  markdown.className = 'markdown-report';
  report.appendChild(markdown);
  content.append(goals, tasks, matrix, report);
  page.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'history-detail-actions';
  actions.append(
    actionButton('复制历史报告', 'history-copy'),
    actionButton('删除历史', 'history-delete', 'btn btn-ghost btn-sm', item.id),
  );
  page.appendChild(actions);
  return page;
}

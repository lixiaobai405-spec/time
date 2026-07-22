import {
  cancelActiveRequest,
  deleteJson,
  getJson,
  postJson,
  setCsrfToken,
} from './api.js';
import {
  renderBoot,
  renderLogin,
  renderRecovery,
  renderRecoveryCode,
  renderRegister,
} from './auth-ui.js';
import { renderHistoryDetail, renderHistoryList } from './history-ui.js';
import {
  createUuid,
  goalSnapshot,
  invalidateAfterGoals,
  invalidateAfterTasks,
  resetState,
  state,
} from './state.js';

const GOAL_FIELDS = Object.freeze([
  { id: '昨', key: '昨天', label: '昨天 · 目标复盘', color: 'var(--purple-700)', description: '过往目标达成、绩效差距及原因', placeholder: '例:上季度获客目标完成 80%…' },
  { id: '今', key: '今天', label: '今天 · 关键工作', color: 'var(--purple)', description: '当前正在推进的重点事项', placeholder: '例:校对方案、跟进客户投诉…' },
  { id: '明', key: '明天', label: '明天 · 短期目标', color: 'var(--orange-600)', description: '近一阶段要达成的目标', placeholder: '例:本月完成选题策划、上线活动…' },
  { id: '后', key: '后天', label: '后天 · 中长期目标', color: 'var(--orange)', description: '部门中长期规划与愿景', placeholder: '例:年内搭建团队分层培养体系…' },
]);
const STEPS = Object.freeze([
  { title: '目标梳理', subtitle: '四天框架输入' },
  { title: '任务提取', subtitle: 'AI拆解 + 手动补充' },
  { title: '矩阵判定', subtitle: '四象限归类' },
  { title: '优先级报告', subtitle: '输出行动建议' },
]);
const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  io: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10h9M9 6l4 4-4 4"/></svg>',
};

let operationId = 0;
const app = () => document.getElementById('app');

function updateAuthBar() {
  const user = document.getElementById('auth-user');
  const logout = document.getElementById('auth-logout');
  const history = document.getElementById('auth-history');
  const authenticated = Boolean(state.authReady && state.user);
  user.classList.toggle('hidden', !authenticated);
  logout.classList.toggle('hidden', !authenticated);
  history.classList.toggle('hidden', !authenticated);
  user.textContent = authenticated ? `已登录：${state.user.username}` : '';
}

function rememberCsrfToken(value) {
  state.csrfToken = typeof value === 'string' && value ? value : null;
  setCsrfToken(state.csrfToken);
}

async function loadPreAuthCsrf() {
  const result = await getJson('/api/auth/csrf');
  rememberCsrfToken(result.csrfToken);
}

async function restoreAuth() {
  try {
    const session = await getJson('/api/auth/me');
    state.user = session.user;
    rememberCsrfToken(session.csrfToken);
    state.authReady = true;
    state.authError = null;
    resetState();
  } catch (error) {
    state.user = null;
    rememberCsrfToken(null);
    state.authReady = true;
    resetState();
    try {
      await loadPreAuthCsrf();
      state.authError = error.status === 401 ? null : error;
    } catch (csrfError) {
      state.authError = csrfError;
    }
  }
  render();
}

function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(element._timer);
  element._timer = setTimeout(() => element.classList.remove('show'), 1800);
}

function clearToast() {
  const element = document.getElementById('toast');
  clearTimeout(element._timer);
  element.classList.remove('show');
  element.textContent = '';
}

function isCurrent(id) {
  return id === operationId && state.screen === 'workspace';
}

function cancelPending() {
  operationId += 1;
  cancelActiveRequest();
  state.pending = null;
}

function startFlow() {
  if (!state.user) return;
  cancelPending();
  clearToast();
  resetState();
  state.screen = 'workspace';
  render();
}

function restartFlow() {
  cancelPending();
  clearToast();
  resetState();
  state.screen = 'workspace';
  render();
}

function goHome() {
  cancelPending();
  clearToast();
  resetState();
  render();
}

function showStep(step) {
  cancelPending();
  state.step = step;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateStep(step) {
  if (step > state.maxStep) {
    const messages = {
      2: '请先提取当前目标中的任务',
      3: '任务数据已变化，请重新判定',
      4: '请先生成当前报告',
    };
    toast(messages[step]);
    return;
  }
  if (step === 2 && (!state.goalReview || state.checkedGoalSnapshot !== goalSnapshot())) {
    toast('请先完成 AI 检查并修正提示项');
    return;
  }
  if (step === 3 && !state.matrix) {
    toast('任务数据已变化，请重新判定');
    return;
  }
  if (step === 4 && !state.report) {
    toast('请先生成当前报告');
    return;
  }
  showStep(step);
}

function head(kicker, title, description) {
  return `<div class="panel-head"><div class="panel-kick">${kicker}</div><div class="panel-h">${title}</div><div class="panel-desc">${description}</div></div>`;
}

function nav({ back, next, label, className, extra } = {}) {
  let content = `<span class="io-hint">${ICONS.io} 输入 · AI动作 · 输出 均按功能清单落地</span>`;
  if (back) content += `<button class="btn btn-ghost" data-action="back">上一步</button>`;
  if (extra) content += extra;
  if (next) content += `<button class="btn ${className || 'btn-primary'}" data-action="${next}">${label || '下一步'} ${ICONS.arrow}</button>`;
  return `<div class="panel-foot">${content}</div>`;
}

function day(field) {
  return `<div class="day-card"><div class="flabel"><span class="daybadge" style="background:${field.color}">${field.id}</span>${field.label}</div>
    <div class="step-sub" style="margin:-4px 0 8px">${field.description}</div>
    <textarea id="g-${field.id}" data-goal="${field.key}" placeholder="${field.placeholder}"></textarea>
    <div class="field-fb" id="fb-${field.id}"></div></div>`;
}

function goalsBody() {
  return `${head('节点 ① · 输入', '目标梳理', '按“昨天-今天-明天-后天”四维梳理你手头的事。填完点“AI 检查并补全”，内容不到位时会给出修正建议。')}
    <div class="panel-body">
      <div class="ai-check-bar"><span class="spark">${ICONS.spark}</span><span>草稿不会保存；报告生成成功后会保存到你的账号历史。<br>请勿填写客户隐私、密码或其他敏感信息。</span></div>
      <div class="grid4day">${GOAL_FIELDS.map(day).join('')}</div>
    </div>
    ${nav({
      extra: `<button class="btn btn-ghost" id="checkBtn" data-action="check-goals">${ICONS.refresh} AI 检查并补全</button>`,
      next: 'extract-tasks',
      label: '提取任务',
    })}`;
}

function tasksBody() {
  return `${head('节点 ② · AI动作 + 手动补充', '任务提取', 'AI 已把四维内容拆成逐条任务并打标签。你可删除，也可手动添加遗漏事项。')}
    <div class="panel-body">
      <div class="tasklist" id="tasklist"></div>
      <button class="addbtn" id="addbtn" data-action="toggle-add">${ICONS.plus} 手动添加任务</button>
      <div class="addform hidden" id="addform">
        <h4>手动添加任务</h4>
        <div class="addgrid">
          <div class="fld full"><label>任务描述<span class="reqmark">*</span></label><input id="f-name" placeholder="要做的事，如:整理季度复盘材料"></div>
          <div class="fld"><label>来源<span class="reqmark">*</span></label><select id="f-src"><option value="">请选择</option><option>复盘</option><option>今天</option><option>短期目标</option><option>中长期</option><option>临时</option></select></div>
          <div class="fld"><label>截止时间<span class="reqmark">*</span></label><input id="f-due" type="date"></div>
          <div class="fld"><label>预估耗时<span class="reqmark">*</span></label><input id="f-cost" placeholder="如:约 2h"></div>
          <div class="fld"><label>重要性 / 紧急度</label><select id="f-flag"><option value="">未标注</option><option value="imp">重要</option><option value="urg">紧急</option><option value="both">重要且紧急</option></select></div>
        </div>
        <div class="err" id="addErr">请填写带 * 的必填项:任务描述、来源、截止时间、耗时。</div>
        <div class="addactions"><button class="btn btn-accent btn-sm" data-action="add-task">${ICONS.plus} 添加到列表</button><button class="btn btn-ghost btn-sm" data-action="cancel-add">取消</button></div>
      </div>
    </div>
    ${nav({ back: true, next: 'classify-matrix', label: '矩阵判定' })}`;
}

function matrixBody() {
  const classes = ['q2', 'q1', 'q4', 'q3'];
  return `${head('节点 ③ · AI动作', '矩阵判定', '每条任务已落入“重要-紧急”四象限，并按固定口径给出精力分配比例。')}
    <div class="panel-body"><div class="matrix-wrap">
      <div class="axis-y"><span>重要</span><span>不重要</span></div>
      <div><div class="matrix">${classes.map(className => `<div class="quad ${className}" data-quadrant="${className}"></div>`).join('')}</div><div class="axis-x"><span>不紧急</span><span>紧急</span></div></div>
    </div></div>
    ${nav({ back: true, next: 'generate-report', label: '生成报告' })}`;
}

function reportBody() {
  return `${head('节点 ④ · 输出', '优先级报告', '一页式可执行报告 —— 优先顺序、各梯队做什么、精力如何分配、需要哪些调整。')}
    <div class="panel-body"><div class="report">
      <div class="bank"><div class="bankb" style="background:var(--purple)"><div class="big">55%</div><div class="lbl">重要且紧急</div></div><div class="bankb" style="background:var(--purple-300)"><div class="big">25%</div><div class="lbl">重要不紧急</div></div><div class="bankb" style="background:var(--orange)"><div class="big">15%</div><div class="lbl">紧急不重要</div></div><div class="bankb" style="background:#B9AFBE"><div class="big">5%</div><div class="lbl">不重要不紧急</div></div></div>
      <div id="report-markdown" class="markdown-report"></div>
      <div class="history-save-status" id="history-save-status"><span id="history-save-message"></span><button class="btn btn-ghost btn-sm hidden" id="history-save-retry" data-action="history-retry">重试保存</button></div>
    </div></div>
    ${nav({ back: true, extra: `<button class="btn btn-ghost btn-sm" data-action="copy-report">${ICONS.copy} 复制报告</button><button class="btn btn-ghost btn-sm" data-action="restart">${ICONS.refresh} 重新梳理</button>`, next: 'finish', label: '完成', className: 'btn-accent' })}`;
}

function body() {
  if (state.step === 1) return goalsBody();
  if (state.step === 2) return tasksBody();
  if (state.step === 3) return matrixBody();
  return reportBody();
}

function renderHome() {
  app().innerHTML = `<div class="home-eyebrow">Management Compass · 管理自我</div><div class="home-h1">把杂乱的事，理成一份优先级清单</div><p class="home-lead">先用“昨天-今天-明天-后天”梳理任务，AI 会检查填写是否到位并帮你补全；再用“重要-紧急矩阵”排序，输出可执行的优先级与精力分配报告。</p><div class="hero-card"><div class="home-eyebrow" style="color:var(--muted)">四步流程</div><div class="hero-flow"><span class="flowchip">目标梳理</span><span class="flowarr">→</span><span class="flowchip">任务提取</span><span class="flowarr">→</span><span class="flowchip">矩阵判定</span><span class="flowarr">→</span><span class="flowchip">优先级报告</span></div><button class="btn btn-primary" data-action="start">开始梳理 ${ICONS.arrow}</button></div>`;
}

function renderWorkspace() {
  app().innerHTML = `<div class="ws-head"><button class="ws-back" data-action="home">${ICONS.back}</button><div class="ws-title">时间管理助手<span class="tag">管理自我</span></div></div><div class="ws-grid"><div class="stepper">${STEPS.map((item, index) => {
    const number = index + 1;
    const active = number === state.step;
    const done = number < state.step;
    const locked = number > state.maxStep;
    return `<div class="step ${active ? 'active' : ''} ${done ? 'done' : ''} ${locked ? 'locked' : ''}" data-step="${number}"><div class="step-num">${done ? '✓' : number}</div><div><div class="step-tt">${item.title}</div><div class="step-sub">${item.subtitle}</div></div></div>`;
  }).join('')}</div><div class="panel" id="panel">${body()}</div></div>`;
  hydrateStep();
}

function renderAuthScreen() {
  let view;
  if (!state.authReady || state.screen === 'boot') view = renderBoot();
  else if (state.screen === 'register') view = renderRegister();
  else if (state.screen === 'recovery') view = renderRecovery();
  else if (state.screen === 'recovery-code' && state.recoveryCode) {
    view = renderRecoveryCode(state.recoveryCode);
  } else view = renderLogin();
  app().replaceChildren(view);
  const error = app().querySelector('.auth-error');
  if (error && state.authError) error.textContent = state.authError.message || '请求失败，请重试。';
}

function renderHistoryScreen() {
  app().replaceChildren(renderHistoryList({
    items: state.historyItems,
    nextCursor: state.historyCursor,
    loading: state.pending === 'history-list',
    error: state.error?.message || '',
  }));
}

function renderHistoryDetailScreen() {
  if (!state.historyDetail) return renderHistoryScreen();
  app().replaceChildren(renderHistoryDetail(state.historyDetail));
  window.renderMarkdown(
    document.getElementById('history-report-markdown'),
    buildReportMarkdown(state.historyDetail.tasks, state.historyDetail.report),
  );
}

function render() {
  updateAuthBar();
  if (!state.authReady || state.screen === 'boot' || state.screen === 'recovery-code') {
    renderAuthScreen();
  } else if (!state.user) {
    renderAuthScreen();
  } else if (state.screen === 'history') {
    renderHistoryScreen();
  } else if (state.screen === 'history-detail') {
    renderHistoryDetailScreen();
  } else if (state.screen === 'home') {
    renderHome();
  } else {
    renderWorkspace();
  }
}

function renderAtTop() {
  render();
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function hydrateGoals() {
  for (const field of GOAL_FIELDS) {
    const textarea = document.getElementById(`g-${field.id}`);
    textarea.value = state.goals[field.key];
    textarea.addEventListener('input', event => {
      state.goals[field.key] = event.target.value;
      invalidateAfterGoals();
      document.querySelectorAll('.field-fb').forEach(item => {
        item.className = 'field-fb';
        item.replaceChildren();
      });
    });
  }
  if (!state.goalReview) return;
  for (const feedback of state.goalReview.fields) {
    const field = GOAL_FIELDS.find(item => item.key === feedback.key);
    const element = document.getElementById(`fb-${field.id}`);
    element.className = `field-fb ${feedback.status} show`;
    if (feedback.status === 'ok') {
      element.textContent = '✓ 信息完整，可进入下一步。';
      continue;
    }
    const issue = document.createElement('div');
    issue.textContent = feedback.issue;
    const suggestion = document.createElement('div');
    suggestion.textContent = feedback.suggestion;
    const adopt = document.createElement('button');
    adopt.type = 'button';
    adopt.className = 'adopt';
    adopt.textContent = '采纳建议';
    adopt.addEventListener('click', () => adoptSuggestion(feedback.key, feedback.suggestion));
    element.replaceChildren(issue, suggestion, adopt);
  }
}

function taskTags(task) {
  const tags = [];
  if (task.importance) {
    tags.push(task.importance === '高' ? ['重要', 'imp'] : ['不重要', '']);
  }
  if (task.urgency) {
    tags.push(task.urgency === '高' ? ['紧急', 'urg'] : ['不紧急', '']);
  }
  if (task.classificationSource === 'unclassified') tags.push(['待 AI 判定', '']);
  if (task.classificationSource === 'ai-matrix') tags.push(['AI 判定', '']);
  tags.push([`来源:${task.source}`, '']);
  if (task.source !== '中长期') {
    tags.push([`截止:${task.due || '待确认'}`, '']);
    if (task.est) tags.push([task.est, '']);
  }
  return tags;
}

function createTaskElement(task) {
  const element = document.createElement('div');
  element.className = `task${task.classificationSource === 'manual' || task.classificationSource === 'unclassified' ? ' manual' : ''}`;
  element.dataset.taskId = task.id;
  const main = document.createElement('div');
  main.style.flex = '1';
  const nameRow = document.createElement('div');
  nameRow.className = 'task-name';
  const name = document.createElement('span');
  window.renderMarkdown(name, task.name, { inline: true });
  nameRow.appendChild(name);
  if (task.classificationSource === 'manual' || task.classificationSource === 'unclassified') {
    const badge = document.createElement('span');
    badge.className = 'mtag';
    badge.textContent = '手动';
    nameRow.appendChild(badge);
  }
  const tags = document.createElement('div');
  tags.className = 'tags';
  for (const [text, className] of taskTags(task)) {
    const tag = document.createElement('span');
    tag.className = `t${className ? ` ${className}` : ''}`;
    tag.textContent = text;
    tags.appendChild(tag);
  }
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.filter(item => typeof item === 'string' && item.trim())
    : [];
  let criteriaBlock;
  if (acceptanceCriteria.length > 0) {
    criteriaBlock = document.createElement('div');
    criteriaBlock.className = 'task-detail acceptance-criteria';
    const title = document.createElement('div');
    title.className = 'task-detail-title';
    title.textContent = '完成标准';
    const list = document.createElement('ul');
    for (const criterion of acceptanceCriteria) {
      const item = document.createElement('li');
      item.textContent = criterion;
      list.appendChild(item);
    }
    criteriaBlock.append(title, list);
  }
  const nextAction = typeof task.nextAction === 'string' ? task.nextAction.trim() : '';
  let nextActionBlock;
  if (nextAction) {
    nextActionBlock = document.createElement('div');
    nextActionBlock.className = 'task-detail next-action';
    const title = document.createElement('div');
    title.className = 'task-detail-title';
    title.textContent = '下一步';
    const action = document.createElement('div');
    action.textContent = nextAction;
    nextActionBlock.append(title, action);
  }
  const remove = document.createElement('button');
  remove.className = 'task-del';
  remove.type = 'button';
  remove.setAttribute('aria-label', '删除任务');
  remove.innerHTML = ICONS.trash;
  remove.addEventListener('click', () => deleteTask(task.id));
  main.append(nameRow, tags);
  if (criteriaBlock) main.appendChild(criteriaBlock);
  if (nextActionBlock) main.appendChild(nextActionBlock);
  element.append(main, remove);
  return element;
}

function hydrateTasks() {
  document.getElementById('tasklist').replaceChildren(...state.tasks.map(createTaskElement));
}

const QUADRANT_CLASSES = Object.freeze({
  '第一象限': 'q1',
  '第二象限': 'q2',
  '第三象限': 'q3',
  '第四象限': 'q4',
});

const QUADRANT_RULES = Object.freeze({
  '第一象限': { priority: 1, action: '立即做', energyPercent: 55 },
  '第二象限': { priority: 2, action: '计划做', energyPercent: 25 },
  '第三象限': { priority: 3, action: '授权做', energyPercent: 15 },
  '第四象限': { priority: 4, action: '减少做', energyPercent: 5 },
});

function workflowDataError(message = '任务数据已变化，请重新判定') {
  return Object.assign(new Error(message), { code: 'WORKFLOW_DATA_CHANGED' });
}

function expectedQuadrant(task) {
  const important = task.importance === '高';
  const urgent = task.urgency === '高';
  if (important && urgent) return '第一象限';
  if (important) return '第二象限';
  if (urgent) return '第三象限';
  return '第四象限';
}

function validateAndMergeMatrix(tasks, matrix) {
  if (!matrix || !Array.isArray(matrix.classifications) || !Array.isArray(matrix.quadrants)) {
    throw workflowDataError();
  }
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const classificationById = new Map();
  for (const item of matrix.classifications) {
    if (!item || classificationById.has(item.taskId) || !taskById.has(item.taskId)
        || !['高', '中', '低'].includes(item.importance)
        || !['高', '中', '低'].includes(item.urgency)) {
      throw workflowDataError();
    }
    classificationById.set(item.taskId, item);
  }
  if (classificationById.size !== tasks.length) throw workflowDataError();

  const mergedTasks = tasks.map(task => {
    const item = classificationById.get(task.id);
    if (!item) throw workflowDataError();
    if (task.classificationSource === 'unclassified') {
      if (task.importance !== null || task.urgency !== null
          || item.classificationSource !== 'ai-matrix') {
        throw workflowDataError();
      }
      return {
        ...task,
        importance: item.importance,
        urgency: item.urgency,
        classificationSource: 'ai-matrix',
      };
    }
    if (item.importance !== task.importance || item.urgency !== task.urgency
        || item.classificationSource !== task.classificationSource) {
      throw workflowDataError();
    }
    return task;
  });

  const quadrantByName = new Map();
  const placedIds = [];
  for (const quadrant of matrix.quadrants) {
    const name = quadrant?.name || quadrant?.q;
    const rule = QUADRANT_RULES[name];
    if (!rule || quadrantByName.has(name) || !Array.isArray(quadrant.taskIds)
        || quadrant.priority !== rule.priority || quadrant.action !== rule.action
        || quadrant.energyPercent !== rule.energyPercent) {
      throw workflowDataError();
    }
    quadrantByName.set(name, quadrant);
    placedIds.push(...quadrant.taskIds);
  }
  if (quadrantByName.size !== 4 || placedIds.length !== tasks.length
      || new Set(placedIds).size !== tasks.length
      || placedIds.some(taskId => !taskById.has(taskId))) {
    throw workflowDataError();
  }
  for (const task of mergedTasks) {
    if (!quadrantByName.get(expectedQuadrant(task)).taskIds.includes(task.id)) {
      throw workflowDataError();
    }
  }
  return mergedTasks;
}

function hydrateMatrix() {
  if (!state.matrix) return;
  const taskById = new Map(state.tasks.map(task => [task.id, task]));
  for (const quadrant of state.matrix.quadrants) {
    const className = QUADRANT_CLASSES[quadrant.name || quadrant.q];
    const element = document.querySelector(`[data-quadrant="${className}"]`);
    const energy = document.createElement('div');
    energy.className = 'energy';
    energy.textContent = `${quadrant.energyPercent}%`;
    const title = document.createElement('div');
    title.className = 'quad-h';
    title.textContent = `${quadrant.name || quadrant.q} · 优先第${quadrant.priority}位`;
    const meta = document.createElement('div');
    meta.className = 'quad-meta';
    meta.textContent = quadrant.action;
    element.append(energy, title, meta);
    for (const taskId of quadrant.taskIds) {
      const item = document.createElement('div');
      item.className = 'qtask';
      item.textContent = taskById.get(taskId)?.name || '';
      element.appendChild(item);
    }
  }
}

function buildReportMarkdown(tasks, report) {
  if (!report) return '';
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const order = report.order.map(item => `- ${taskById.get(item.taskId).name} — ${item.reason}`);
  const energy = report.energyRules.map(item => `- ${item}`);
  const adjustments = report.adjustments.map(item => `- ${item}`);
  return [`## 今日优先处理顺序`, '', ...order, '', '## 精力分配原则', '', ...energy, '', '## 需结合复盘与目标的调整', '', ...adjustments].join('\n');
}

function reportMarkdown() {
  return buildReportMarkdown(state.tasks, state.report);
}

function validateReport(tasks, report) {
  const error = () => workflowDataError('任务数据已变化，请重新生成报告');
  if (!report || !Array.isArray(report.order) || !Array.isArray(report.energyRules)
      || !Array.isArray(report.adjustments)) {
    throw error();
  }
  const taskIds = new Set(tasks.map(task => task.id));
  const orderedIds = new Set();
  for (const item of report.order) {
    if (!item || !taskIds.has(item.taskId) || orderedIds.has(item.taskId)
        || typeof item.reason !== 'string' || !item.reason.trim()) {
      throw error();
    }
    orderedIds.add(item.taskId);
  }
  if ((tasks.length >= 3 && (report.order.length < 3 || report.order.length > 5))
      || report.order.length > tasks.length
      || [...report.energyRules, ...report.adjustments].some(item =>
        typeof item !== 'string' || !item.trim())) {
    throw error();
  }
  return report;
}

function hydrateReport() {
  window.renderMarkdown(document.getElementById('report-markdown'), reportMarkdown());
  const status = document.getElementById('history-save-status');
  const message = document.getElementById('history-save-message');
  const retry = document.getElementById('history-save-retry');
  const messages = {
    idle: '报告生成后将自动保存历史。',
    saving: '正在保存历史…',
    saved: '历史已保存。',
    failed: '报告已生成，但历史保存失败。',
  };
  status.classList.toggle('failed', state.historySave.status === 'failed');
  message.textContent = messages[state.historySave.status] || state.historySave.message;
  retry.classList.toggle('hidden', state.historySave.status !== 'failed');
}

function hydrateStep() {
  if (state.step === 1) hydrateGoals();
  if (state.step === 2) hydrateTasks();
  if (state.step === 3) hydrateMatrix();
  if (state.step === 4) hydrateReport();
}

function renderProcessing(title, subtitle, steps) {
  const panel = document.getElementById('panel');
  const process = document.createElement('div');
  process.className = 'aiproc';
  const orb = document.createElement('div');
  orb.className = 'ai-orb';
  const heading = document.createElement('div');
  heading.className = 'ai-proc-t';
  heading.textContent = title;
  const detail = document.createElement('div');
  detail.className = 'ai-proc-s';
  detail.textContent = subtitle;
  const list = document.createElement('div');
  list.className = 'ai-steps';
  for (const text of steps) {
    const item = document.createElement('div');
    item.className = 'ai-step on';
    const dot = document.createElement('span');
    dot.className = 'dot';
    item.append(dot, document.createTextNode(text));
    list.appendChild(item);
  }
  process.append(orb, heading, detail, list);
  panel.replaceChildren(process);
}

function handleWorkflowError(error, id) {
  if (!isCurrent(id) || error.code === 'REQUEST_CANCELLED') return;
  state.pending = null;
  state.error = error;
  render();
  toast(error.message || '请求失败，请重试。');
}

async function checkGoals() {
  if (state.pending) return;
  const id = ++operationId;
  state.pending = 'goals';
  const button = document.getElementById('checkBtn');
  button.disabled = true;
  button.innerHTML = '<span class="mini-spin"></span> 检查中…';
  try {
    const review = await postJson('/api/time-management/goals/check', { goals: state.goals });
    if (!isCurrent(id)) return;
    state.pending = null;
    state.goalReview = review;
    state.checkedGoalSnapshot = review.overall === 'pass' ? goalSnapshot() : null;
    state.maxStep = 1;
    render();
    toast(review.overall === 'pass' ? '目标输入已通过检查' : '仍有待修正项，暂不能进入下一步');
  } catch (error) {
    handleWorkflowError(error, id);
  }
}

function adoptSuggestion(key, suggestion) {
  state.goals[key] = suggestion;
  invalidateAfterGoals();
  render();
  toast('已采纳建议，请按实际情况修改后重新检查');
}

function goalsAreApproved() {
  return state.goalReview?.overall === 'pass' && state.checkedGoalSnapshot === goalSnapshot();
}

async function extractTasks() {
  if (!goalsAreApproved()) {
    toast('请先完成 AI 检查并修正提示项');
    return;
  }
  const id = ++operationId;
  state.pending = 'tasks';
  renderProcessing('正在拆解任务要素', '把四维内容整理成可执行任务并打标签', ['读取四维目标输入', '拆解为独立可执行任务', '标注重要性与紧急度']);
  try {
    const result = await postJson('/api/time-management/tasks/extract', { goals: state.goals });
    if (!isCurrent(id)) return;
    state.pending = null;
    state.tasks = result.tasks;
    state.matrix = null;
    state.report = null;
    state.step = 2;
    state.maxStep = 2;
    clearToast();
    renderAtTop();
  } catch (error) {
    handleWorkflowError(error, id);
  }
}

async function classifyTasks() {
  if (state.pending) return;
  const id = ++operationId;
  state.pending = 'matrix';
  renderProcessing('正在进行矩阵判定', '将任务落入四象限并分配精力', ['判定每条任务的重要/紧急', '落位重要-紧急四象限', '按象限计算精力分配']);
  try {
    const matrix = await postJson('/api/time-management/matrix/classify', { tasks: state.tasks });
    if (!isCurrent(id)) return;
    const mergedTasks = validateAndMergeMatrix(state.tasks, matrix);
    state.tasks = mergedTasks;
    state.pending = null;
    state.matrix = matrix;
    state.report = null;
    state.step = 3;
    state.maxStep = 3;
    clearToast();
    renderAtTop();
  } catch (error) {
    handleWorkflowError(error, id);
  }
}

async function generateReport() {
  if (state.pending || !state.matrix) return;
  const id = ++operationId;
  state.pending = 'report';
  renderProcessing('正在生成时间管理报告', '汇总优先顺序、精力分配与调整建议', ['汇总四象限排序', '结合复盘与目标校准', '输出行动建议']);
  try {
    const report = await postJson('/api/time-management/report/generate', {
      tasks: state.tasks,
      matrix: state.matrix,
      goals: state.goals,
    });
    if (!isCurrent(id)) return;
    validateReport(state.tasks, report);
    state.pending = null;
    state.report = report;
    state.step = 4;
    state.maxStep = 4;
    clearToast();
    renderAtTop();
    saveCurrentHistory();
  } catch (error) {
    handleWorkflowError(error, id);
  }
}

function toggleAdd(show) {
  document.getElementById('addform').classList.toggle('hidden', !show);
  document.getElementById('addbtn').classList.toggle('hidden', show);
}

function addTask() {
  const name = document.getElementById('f-name').value.trim();
  const source = document.getElementById('f-src').value;
  const due = document.getElementById('f-due').value;
  const est = document.getElementById('f-cost').value.trim();
  const flag = document.getElementById('f-flag').value;
  if (!name || !source || !due || !est) {
    document.getElementById('addErr').classList.add('show');
    return;
  }
  const flags = {
    imp: { importance: '高', urgency: '低', classificationSource: 'manual' },
    urg: { importance: '低', urgency: '高', classificationSource: 'manual' },
    both: { importance: '高', urgency: '高', classificationSource: 'manual' },
    unclassified: { importance: null, urgency: null, classificationSource: 'unclassified' },
  };
  state.tasks.push({
    id: createUuid(),
    name,
    source,
    due,
    est: est.startsWith('约') ? est : `约${est}`,
    acceptanceCriteria: [],
    nextAction: '',
    status: 'pending',
    ...(flags[flag] || flags.unclassified),
  });
  invalidateAfterTasks();
  render();
  toast('已添加任务');
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter(task => task.id !== taskId);
  invalidateAfterTasks();
  render();
  toast('任务已删除，请重新判定');
}

async function copyReport() {
  const text = document.querySelector('.report')?.innerText.trim();
  if (!text) return toast('没有可复制内容');
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制报告');
  } catch {
    toast('复制失败，请手动选择内容');
  }
}

function currentHistoryTitle() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} 时间管理报告`;
}

function currentHistorySnapshot() {
  return {
    clientRunId: state.clientRunId,
    title: currentHistoryTitle(),
    goals: state.goals,
    tasks: state.tasks,
    matrix: state.matrix,
    report: state.report,
  };
}

function renderCurrentHistoryStatus() {
  if (state.screen === 'workspace' && state.step === 4) render();
}

async function saveCurrentHistory() {
  if (!state.report || !state.matrix || state.historySave.status === 'saving') return;
  const clientRunId = state.clientRunId;
  const snapshot = currentHistorySnapshot();
  state.historySave = { status: 'saving', id: state.historySave.id, message: '' };
  renderCurrentHistoryStatus();
  try {
    const item = await postJson('/api/time-management/history', snapshot);
    if (state.clientRunId !== clientRunId) return;
    state.historySave = { status: 'saved', id: item.id, message: '' };
    renderCurrentHistoryStatus();
  } catch {
    if (state.clientRunId !== clientRunId) return;
    state.historySave = {
      status: 'failed',
      id: state.historySave.id,
      message: '报告已生成，但历史保存失败。',
    };
    renderCurrentHistoryStatus();
  }
}

async function loadHistory({ append = false } = {}) {
  if (state.pending === 'history-list') return;
  const cursor = append ? state.historyCursor : null;
  if (!append) {
    state.historyItems = [];
    state.historyCursor = null;
  }
  state.pending = 'history-list';
  state.error = null;
  render();
  try {
    const query = new URLSearchParams({ limit: '20' });
    if (cursor) query.set('cursor', cursor);
    const result = await getJson(`/api/time-management/history?${query}`);
    state.historyItems = append ? [...state.historyItems, ...result.items] : result.items;
    state.historyCursor = result.nextCursor;
    state.pending = null;
    if (state.screen === 'history') render();
  } catch (error) {
    state.pending = null;
    state.error = error;
    if (state.screen === 'history') render();
  }
}

function openHistory() {
  operationId += 1;
  if (state.pending) cancelActiveRequest();
  state.pending = null;
  state.error = null;
  state.historyDetail = null;
  state.screen = 'history';
  render();
  loadHistory();
}

async function openHistoryDetail(id) {
  if (state.pending) return;
  state.pending = 'history-detail';
  state.error = null;
  try {
    state.historyDetail = await getJson(`/api/time-management/history/${encodeURIComponent(id)}`);
    state.pending = null;
    state.screen = 'history-detail';
    render();
  } catch (error) {
    state.pending = null;
    state.error = error;
    state.screen = 'history';
    render();
  }
}

async function deleteHistory(id) {
  if (!window.confirm('确定删除这条历史记录吗？')) return;
  if (state.pending) return;
  state.pending = 'history-delete';
  try {
    await deleteJson(`/api/time-management/history/${encodeURIComponent(id)}`);
    state.historyItems = state.historyItems.filter(item => item.id !== id);
    if (state.historyDetail?.id === id) {
      state.historyDetail = null;
      state.screen = 'history';
    }
    state.pending = null;
    state.error = null;
    render();
  } catch (error) {
    state.pending = null;
    state.error = error;
    render();
  }
}

async function copyHistory() {
  const text = document.querySelector('.history-detail-content')?.innerText.trim();
  if (!text) return toast('没有可复制内容');
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制历史报告');
  } catch {
    toast('复制失败，请手动选择内容');
  }
}

function showAuthScreen(screen) {
  cancelPending();
  state.authError = null;
  state.recoveryCode = null;
  state.screen = screen;
  render();
}

function authError(form, message) {
  const element = form.querySelector('.auth-error');
  element.textContent = message || '请求失败，请重试。';
}

async function submitLogin(form) {
  if (state.pending) return;
  const data = new FormData(form);
  state.pending = 'auth';
  authError(form, '');
  form.querySelector('[type="submit"]').disabled = true;
  try {
    await postJson('/api/auth/login', {
      username: data.get('username'),
      password: data.get('password'),
    });
    const session = await getJson('/api/auth/me');
    state.user = session.user;
    rememberCsrfToken(session.csrfToken);
    state.authReady = true;
    state.authError = null;
    state.recoveryCode = null;
    state.pending = null;
    resetState();
    clearToast();
    render();
  } catch (error) {
    state.pending = null;
    authError(form, error.message);
    form.querySelector('[type="submit"]').disabled = false;
  }
}

async function submitRegister(form) {
  if (state.pending) return;
  const data = new FormData(form);
  if (data.get('password') !== data.get('passwordConfirm')) {
    authError(form, '两次输入的密码不一致。');
    return;
  }
  state.pending = 'auth';
  authError(form, '');
  form.querySelector('[type="submit"]').disabled = true;
  try {
    const result = await postJson('/api/auth/register', {
      username: data.get('username'),
      password: data.get('password'),
    });
    state.pending = null;
    state.authError = null;
    state.recoveryCode = result.recoveryCode;
    state.screen = 'recovery-code';
    render();
  } catch (error) {
    state.pending = null;
    authError(form, error.message);
    form.querySelector('[type="submit"]').disabled = false;
  }
}

async function submitRecovery(form) {
  if (state.pending) return;
  const data = new FormData(form);
  if (data.get('newPassword') !== data.get('newPasswordConfirm')) {
    authError(form, '两次输入的新密码不一致。');
    return;
  }
  state.pending = 'auth';
  authError(form, '');
  form.querySelector('[type="submit"]').disabled = true;
  try {
    const result = await postJson('/api/auth/password/reset-with-recovery', {
      username: data.get('username'),
      recoveryCode: data.get('recoveryCode'),
      newPassword: data.get('newPassword'),
    });
    state.pending = null;
    state.authError = null;
    state.recoveryCode = result.recoveryCode;
    state.screen = 'recovery-code';
    render();
  } catch (error) {
    state.pending = null;
    authError(form, error.message);
    form.querySelector('[type="submit"]').disabled = false;
  }
}

async function logout() {
  if (state.pending) return;
  cancelPending();
  state.pending = 'auth';
  try {
    await postJson('/api/auth/logout');
    state.user = null;
    rememberCsrfToken(null);
    state.recoveryCode = null;
    state.authError = null;
    state.pending = null;
    resetState();
    await loadPreAuthCsrf();
    render();
  } catch (error) {
    state.pending = null;
    toast(error.message || '退出失败，请重试。');
  }
}

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-auth-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.authForm === 'login') submitLogin(form);
  else if (form.dataset.authForm === 'register') submitRegister(form);
  else if (form.dataset.authForm === 'recovery') submitRecovery(form);
});

document.addEventListener('click', event => {
  const step = event.target.closest('[data-step]');
  if (step) return navigateStep(Number(step.dataset.step));
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!action) return;
  if (action === 'start') startFlow();
  else if (action === 'home' || action === 'finish') goHome();
  else if (action === 'back') showStep(state.step - 1);
  else if (action === 'check-goals') checkGoals();
  else if (action === 'extract-tasks') extractTasks();
  else if (action === 'classify-matrix') classifyTasks();
  else if (action === 'generate-report') generateReport();
  else if (action === 'toggle-add') toggleAdd(true);
  else if (action === 'cancel-add') toggleAdd(false);
  else if (action === 'add-task') addTask();
  else if (action === 'copy-report') copyReport();
  else if (action === 'restart') restartFlow();
  else if (action === 'show-register') showAuthScreen('register');
  else if (action === 'show-recovery') showAuthScreen('recovery');
  else if (action === 'show-login') showAuthScreen('login');
  else if (action === 'confirm-recovery-code') showAuthScreen(state.user ? 'home' : 'login');
  else if (action === 'logout') logout();
  else if (action === 'history-open') openHistory();
  else if (action === 'history-home') goHome();
  else if (action === 'history-back') {
    state.historyDetail = null;
    state.screen = 'history';
    render();
  } else if (action === 'history-more') loadHistory({ append: true });
  else if (action === 'history-detail') openHistoryDetail(actionElement.dataset.historyId);
  else if (action === 'history-delete') deleteHistory(actionElement.dataset.historyId);
  else if (action === 'history-copy') copyHistory();
  else if (action === 'history-retry') saveCurrentHistory();
});

document.querySelector('.brand').addEventListener('click', goHome);
render();
restoreAuth();

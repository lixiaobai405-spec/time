export const GOAL_KEYS = Object.freeze(['昨天', '今天', '明天', '后天']);

export function createUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('当前浏览器不支持安全随机数生成。');
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptyGoals() {
  return Object.fromEntries(GOAL_KEYS.map(key => [key, '']));
}

function idleHistorySave() {
  return { status: 'idle', id: null, message: '' };
}

export const state = {
  authReady: false,
  user: null,
  csrfToken: null,
  screen: 'boot',
  recoveryCode: null,
  authError: null,
  step: 1,
  maxStep: 1,
  goals: emptyGoals(),
  goalReview: null,
  checkedGoalSnapshot: null,
  tasks: [],
  matrix: null,
  report: null,
  clientRunId: createUuid(),
  historySave: idleHistorySave(),
  historyItems: [],
  historyCursor: null,
  historyDetail: null,
  pending: null,
  error: null,
};

export function goalSnapshot() {
  return JSON.stringify(state.goals);
}

export function invalidateAfterGoals() {
  state.goalReview = null;
  state.checkedGoalSnapshot = null;
  state.tasks = [];
  state.matrix = null;
  state.report = null;
  state.historySave = idleHistorySave();
  state.maxStep = 1;
}

export function invalidateAfterTasks() {
  state.matrix = null;
  state.report = null;
  state.historySave = idleHistorySave();
  state.maxStep = Math.min(state.maxStep, 2);
}

export function resetState() {
  state.screen = state.user ? 'home' : 'login';
  state.step = 1;
  state.maxStep = 1;
  state.goals = emptyGoals();
  state.goalReview = null;
  state.checkedGoalSnapshot = null;
  state.tasks = [];
  state.matrix = null;
  state.report = null;
  state.clientRunId = createUuid();
  state.historySave = idleHistorySave();
  state.historyItems = [];
  state.historyCursor = null;
  state.historyDetail = null;
  state.pending = null;
  state.error = null;
}

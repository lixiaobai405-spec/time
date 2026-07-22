export const CATEGORY_KEYS = Object.freeze(['昨天', '今天', '明天', '后天']);

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

function emptyEntries() {
  return Object.fromEntries(CATEGORY_KEYS.map(key => [key, '']));
}

function idleHistorySave() {
  return { status: 'idle', id: null, message: '' };
}

export const state = {
  authReady: false,
  user: null,
  csrfToken: null,
  screen: 'boot',
  authMode: 'login',
  recoveryCode: null,
  authError: null,

  step: 1,
  maxStep: 1,
  entries: emptyEntries(),
  intake: null,
  tasks: [],
  smart: null,
  smartChecked: false,
  distribution: null,
  matrix: null,
  report: null,
  clientRunId: createUuid(),

  tracking: {},
  sessionHistory: [],
  rolledDates: {},

  historySave: idleHistorySave(),
  historyItems: [],
  historyCursor: null,
  historyDetail: null,

  pending: null,
  error: null,
  modal: null,
};

export function entrySnapshot() {
  return JSON.stringify(state.entries);
}

export function taskSnapshot() {
  return JSON.stringify(state.tasks);
}

export function invalidateAfterEntries() {
  state.intake = null;
  state.tasks = [];
  state.smart = null;
  state.smartChecked = false;
  state.distribution = null;
  state.matrix = null;
  state.report = null;
  state.tracking = {};
  state.historySave = idleHistorySave();
  state.maxStep = 1;
  state.clientRunId = createUuid();
}

export function invalidateAfterTasks() {
  state.smart = null;
  state.smartChecked = false;
  state.distribution = null;
  state.matrix = null;
  state.report = null;
  state.historySave = idleHistorySave();
  state.maxStep = Math.min(Math.max(state.maxStep, 2), 2);
  state.clientRunId = createUuid();
}

export function invalidateAfterDistribution() {
  state.matrix = null;
  state.report = null;
  state.historySave = idleHistorySave();
  state.maxStep = Math.min(Math.max(state.maxStep, 3), 3);
  state.clientRunId = createUuid();
}

export function resetWorkflow({ keepEntries = false } = {}) {
  state.step = 1;
  state.maxStep = 1;
  if (!keepEntries) state.entries = emptyEntries();
  state.intake = null;
  state.tasks = [];
  state.smart = null;
  state.smartChecked = false;
  state.distribution = null;
  state.matrix = null;
  state.report = null;
  state.tracking = {};
  state.clientRunId = createUuid();
  state.historySave = idleHistorySave();
  state.pending = null;
  state.error = null;
  state.modal = null;
}

export function resetState() {
  resetWorkflow();
  state.screen = state.user ? 'home' : 'login';
  state.authMode = 'login';
  state.historyItems = [];
  state.historyCursor = null;
  state.historyDetail = null;
  state.sessionHistory = [];
  state.rolledDates = {};
}

// Compatibility exports retained for existing callers while the UI migrates to the five-step names.
export const GOAL_KEYS = CATEGORY_KEYS;
export const goalSnapshot = entrySnapshot;
export const invalidateAfterGoals = invalidateAfterEntries;

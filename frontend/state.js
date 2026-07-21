export const GOAL_KEYS = Object.freeze(['昨天', '今天', '明天', '后天']);

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
  clientRunId: crypto.randomUUID(),
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
  state.clientRunId = crypto.randomUUID();
  state.historySave = idleHistorySave();
  state.historyItems = [];
  state.historyCursor = null;
  state.historyDetail = null;
  state.pending = null;
  state.error = null;
}

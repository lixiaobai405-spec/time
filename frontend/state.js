export const GOAL_KEYS = Object.freeze(['昨天', '今天', '明天', '后天']);

function emptyGoals() {
  return Object.fromEntries(GOAL_KEYS.map(key => [key, '']));
}

export const state = {
  screen: 'home',
  step: 1,
  maxStep: 1,
  goals: emptyGoals(),
  goalReview: null,
  checkedGoalSnapshot: null,
  tasks: [],
  matrix: null,
  report: null,
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
  state.maxStep = 1;
}

export function invalidateAfterTasks() {
  state.matrix = null;
  state.report = null;
  state.maxStep = Math.min(state.maxStep, 2);
}

export function resetState() {
  state.screen = 'home';
  state.step = 1;
  state.maxStep = 1;
  state.goals = emptyGoals();
  state.goalReview = null;
  state.checkedGoalSnapshot = null;
  state.tasks = [];
  state.matrix = null;
  state.report = null;
  state.pending = null;
  state.error = null;
}

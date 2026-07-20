const {
  DEFAULT_TIME_ZONE,
  parseExplicitDue,
  referenceDateInTimeZone,
} = require('./deadline');

const QUADRANT_GROUP = Object.freeze({
  第一象限: 0,
  第二象限: 2,
  第四象限: 4,
});

function quadrantName(quadrant) {
  return quadrant?.name || quadrant?.q;
}

function buildMembership(matrix) {
  const membership = new Map();
  for (const quadrant of matrix?.quadrants || []) {
    const name = quadrantName(quadrant);
    for (const taskId of quadrant.taskIds || []) membership.set(taskId, name);
  }
  return membership;
}

function groupFor(quadrant, protectedDue) {
  if (quadrant === '第三象限') return protectedDue ? 1 : 3;
  return QUADRANT_GROUP[quadrant] ?? 4;
}

function actionFor(group) {
  return ['立即处理', '立即授权', '计划处理', '授权处理', '减少处理'][group];
}

function buildReportPriorityContext({
  tasks,
  matrix,
  now = Date.now,
  timeZone = DEFAULT_TIME_ZONE,
}) {
  const referenceDate = referenceDateInTimeZone(now, timeZone);
  const membership = buildMembership(matrix);
  const candidates = tasks.map((task, index) => {
    const due = parseExplicitDue(task.due);
    const protectedDue = Boolean(due && due.date <= referenceDate);
    const group = groupFor(membership.get(task.id), protectedDue);
    return { task, index, due, protectedDue, group };
  });

  candidates.sort((left, right) => {
    if (left.group !== right.group) return left.group - right.group;
    if (Boolean(left.due) !== Boolean(right.due)) return left.due ? -1 : 1;
    if (left.due && right.due && left.due.sortKey !== right.due.sortKey) {
      return left.due.sortKey < right.due.sortKey ? -1 : 1;
    }
    return left.index - right.index;
  });

  const orderedTaskIds = candidates.map(item => item.task.id);
  const recommendedTaskIds = orderedTaskIds.slice(0, Math.min(5, tasks.length));
  const recommended = new Set(recommendedTaskIds);
  const protectedTaskIds = candidates
    .filter(item => item.protectedDue)
    .map(item => item.task.id);

  return {
    recommendedTaskIds,
    protectedTaskIds,
    remainingProtectedTaskIds: protectedTaskIds.filter(taskId => !recommended.has(taskId)),
    actionByTaskId: Object.fromEntries(candidates.map(item => [
      item.task.id,
      actionFor(item.group),
    ])),
  };
}

module.exports = { buildReportPriorityContext };

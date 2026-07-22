const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const EXPLICIT_DUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const RELATIVE_DUE_PATTERN = /^(今天|今日|明天)(?:\s*([01]?\d|2[0-3]):([0-5]\d)\s*前?)?$/;
const URGENCY_SIGNAL = /紧急|立即|马上|尽快|今天必须|今日必须|当天交付|影响当天交付|阻塞/;

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError('now must resolve to a valid date');
  return instant;
}

function referenceDateInTimeZone(now = Date.now, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(resolveNow(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidCalendarDate(year, month, day) {
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseExplicitDue(due) {
  if (typeof due !== 'string') return null;
  const match = EXPLICIT_DUE_PATTERN.exec(due.trim());
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!isValidCalendarDate(year, month, day)) return null;

  let time = null;
  if (hourText != null) {
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (hour > 23 || minute > 59) return null;
    time = `${hourText}:${minuteText}`;
  }

  const date = `${yearText}-${monthText}-${dayText}`;
  return {
    date,
    time,
    sortKey: `${date}T${time || '23:59'}`,
  };
}

function addCalendarDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parseRelativeDue(due, context = {}) {
  if (typeof due !== 'string') return null;
  const match = RELATIVE_DUE_PATTERN.exec(due.trim());
  if (!match) return null;

  const [, relativeDay, hourText, minuteText] = match;
  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  const date = addCalendarDays(referenceDate, relativeDay === '明天' ? 1 : 0);
  const time = hourText == null
    ? null
    : `${String(Number(hourText)).padStart(2, '0')}:${minuteText}`;
  return {
    date,
    time,
    sortKey: `${date}T${time || '23:59'}`,
  };
}

function parseDue(due, context = {}) {
  return parseExplicitDue(due) || parseRelativeDue(due, context);
}

function hasUrgencySignal(task, goalText = '') {
  return URGENCY_SIGNAL.test([
    task?.name,
    task?.due,
    task?.nextAction,
    ...(task?.acceptanceCriteria || []),
    goalText,
  ].filter(Boolean).join('\n'));
}

function calendarDayDistance(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function applyDeadlineUrgency(task, context = {}) {
  const result = { ...task };
  const parsed = parseDue(task?.due, context);
  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  if (parsed && parsed.date <= referenceDate) {
    result.urgency = '高';
    return result;
  }

  if (hasUrgencySignal(result, context.goalText)) {
    result.urgency = '高';
    return result;
  }

  if (parsed) {
    const daysUntilDue = calendarDayDistance(referenceDate, parsed.date);
    result.urgency = daysUntilDue <= 7 ? '中' : '低';
    return result;
  }

  const dueText = typeof result.due === 'string' ? result.due.trim() : '';
  const isUnknown = !dueText || dueText === '待确认';
  if (result.source === '今天' && isUnknown) {
    result.urgency = '高';
  } else if (isUnknown || result.source === '中长期') {
    result.urgency = '低';
  } else {
    result.urgency = '中';
  }
  return result;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  applyDeadlineUrgency,
  parseDue,
  parseExplicitDue,
  referenceDateInTimeZone,
};

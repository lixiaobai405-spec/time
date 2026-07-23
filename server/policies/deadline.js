const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const EXPLICIT_DUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const RELATIVE_DUE_PATTERN = /^(今天|今日|明天|后天)(?:\s*([01]?\d|2[0-3]):([0-5]\d)\s*前?)?$/;
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
  const offsets = { 今天: 0, 今日: 0, 明天: 1, 后天: 2 };
  const date = addCalendarDays(referenceDate, offsets[relativeDay]);
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

function normalizeDue(due, context = {}) {
  const parsed = parseDue(due, context);
  if (!parsed) return '待确认';
  return parsed.time ? `${parsed.date} ${parsed.time}` : parsed.date;
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
  const parsed = parseDue(task?.due, context);
  const result = {
    ...task,
    due: normalizeDue(task?.due, context),
  };
  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  if (parsed && parsed.date <= referenceDate) {
    result.urgency = '高';
    return result;
  }

  if (hasUrgencySignal(task, context.goalText)) {
    result.urgency = '高';
    return result;
  }

  if (parsed) {
    const daysUntilDue = calendarDayDistance(referenceDate, parsed.date);
    result.urgency = daysUntilDue <= 7 ? '中' : '低';
    return result;
  }

  if (result.source === '今天') {
    result.urgency = '高';
  } else {
    result.urgency = '低';
  }
  return result;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  applyDeadlineUrgency,
  normalizeDue,
  parseDue,
  parseExplicitDue,
  referenceDateInTimeZone,
};

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const EXPLICIT_DUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;

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

function applyDeadlineUrgency(task, context = {}) {
  const parsed = parseExplicitDue(task?.due);
  const result = { ...task };
  if (!parsed) return result;

  const referenceDate = referenceDateInTimeZone(
    context.now || Date.now,
    context.timeZone || DEFAULT_TIME_ZONE,
  );
  if (parsed.date <= referenceDate) result.urgency = '高';
  return result;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  applyDeadlineUrgency,
  parseExplicitDue,
  referenceDateInTimeZone,
};

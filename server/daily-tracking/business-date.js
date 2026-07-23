const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const SHANGHAI_OFFSET = '+08:00';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function shanghaiDate(value) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shanghaiBusinessDay(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) throw new TypeError('A valid current date is required.');
  const trackingDate = shanghaiDate(value);
  const start = new Date(`${trackingDate}T00:00:00.000${SHANGHAI_OFFSET}`);
  const end = new Date(start.getTime() + 86_400_000);
  return Object.freeze({
    trackingDate,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  });
}

module.exports = { SHANGHAI_TIME_ZONE, shanghaiBusinessDay };

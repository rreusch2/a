const FIELD = /^(\*|\*\/\d+|\d+(-\d+)?)(,(\*|\*\/\d+|\d+(-\d+)?))*$/;

export function assertCron(expression: string): void {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts.some((part) => !FIELD.test(part))) {
    throw new Error('Use a 5-field cron expression, for example "0 8 * * 1-5".');
  }
}

export function cronMatches(expression: string, date: Date): boolean {
  assertCron(expression);
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/);
  return (
    matchField(minute ?? '*', date.getUTCMinutes(), 0, 59) &&
    matchField(hour ?? '*', date.getUTCHours(), 0, 23) &&
    matchField(day ?? '*', date.getUTCDate(), 1, 31) &&
    matchField(month ?? '*', date.getUTCMonth() + 1, 1, 12) &&
    matchField(weekday ?? '*', date.getUTCDay(), 0, 6)
  );
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
  return expr.split(',').some((part) => matchPart(part, value, min, max));
}

function matchPart(part: string, value: number, min: number, max: number): boolean {
  if (part === '*') return value >= min && value <= max;
  if (part.startsWith('*/')) {
    const step = Number(part.slice(2));
    if (!Number.isFinite(step) || step <= 0) return false;
    return value >= min && value <= max && (value - min) % step === 0;
  }
  if (part.includes('-')) {
    const [start, end] = part.split('-').map(Number);
    return value >= (start ?? NaN) && value <= (end ?? NaN);
  }
  return Number(part) === value;
}

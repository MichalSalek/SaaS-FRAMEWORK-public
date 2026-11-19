export interface TimeValue {
  totalMinutes: number;
  hours: number;
  remainingMinutes: number;
}
export const DEFAULT_TIME_ASSUMPTIONS = {
  minutes: '10',
  clients: '8',
} as const;

/** Empty, fractional, negative and unsafe values cannot describe an example day. */
export function calculateTimeValue(
  minutesPerClient: string,
  clientsPerDay: string
): TimeValue | null {
  const parse = (value: string): number | null => {
    if (!/^\d+$/.test(value)) {
      return null;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  };
  const minutes = parse(minutesPerClient);
  const clients = parse(clientsPerDay);
  if (minutes === null || clients === null) {
    return null;
  }

  const totalMinutes = minutes * clients;
  if (!Number.isSafeInteger(totalMinutes)) {
    return null;
  }
  return {
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    remainingMinutes: totalMinutes % 60,
  };
}

export const defaultDuration = 60;

const romeClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function walkTiming(day, time, duration) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
    || !Number.isInteger(duration) || duration < 5 || duration > 1440) return null;

  const localTime = day + " " + time;
  const nominalUtc = Date.parse(day + "T" + time + ":00Z");
  if (!Number.isFinite(nominalUtc)) return null;

  // On the autumn clock change, use the first occurrence of the repeated time.
  for (const offsetMinutes of [120, 60]) {
    const instant = nominalUtc - offsetMinutes * 60000;
    if (romeClock.format(instant) === localTime) {
      const startsAt = instant / 1000;
      return { startsAt, endsAt: startsAt + duration * 60 };
    }
  }
  return null;
}

/**
 * Returns true when `timeZone` is an IANA time zone name the runtime knows,
 * e.g. `Europe/Berlin`. Offsets such as `+02:00` are rejected on purpose:
 * user timezones are always stored as IANA names.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

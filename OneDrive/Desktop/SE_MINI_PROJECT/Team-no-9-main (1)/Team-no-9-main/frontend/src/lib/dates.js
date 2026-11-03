// Display formats for API timestamps (ISO 8601 in UTC, SAD 4.3.1), shown in IST.
const date = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** "19 Oct 2026" */
export function formatDate(iso) {
  return date.format(new Date(iso));
}

/** "19 Oct 2026, 2:15 pm IST" */
export function formatDateTime(iso) {
  return `${dateTime.format(new Date(iso))} IST`;
}

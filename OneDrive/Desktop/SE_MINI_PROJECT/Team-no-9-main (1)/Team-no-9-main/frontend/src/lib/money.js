// Money helpers.
// The API sends money as decimal strings (e.g. "2800.00") to avoid floating-point
// errors (SAD 4.3.1). We do all arithmetic in integer paise using BigInt and only
// convert to a Number for display.

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/** Parse a decimal money string like "2800.5" into BigInt paise (280050n). */
export function toPaise(value) {
  const str = String(value).trim();
  if (!MONEY_PATTERN.test(str)) {
    throw new Error(`Invalid money value: "${value}"`);
  }
  const negative = str.startsWith('-');
  const [rupees, fraction = ''] = str.replace('-', '').split('.');
  const paise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -paise : paise;
}

/** Convert BigInt paise back to a decimal string with 2 places, e.g. 280050n -> "2800.50". */
export function fromPaise(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${rupees}.${fraction}`;
}

/** Sum a list of decimal money strings exactly. Returns a decimal string. */
export function sumMoney(values) {
  return fromPaise(values.reduce((total, v) => total + toPaise(v), 0n));
}

const inrFull = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Full INR format with Indian digit grouping: "10345000.00" -> "₹1,03,45,000.00". */
export function formatINR(value) {
  return inrFull.format(Number(value));
}

/**
 * Short INR format using lakh / crore, for tight spaces such as chart labels.
 * "10345000.00" -> "₹1.03 Cr", "645000.00" -> "₹6.45 L", "28500.00" -> "₹28,500".
 */
export function formatINRCompact(value) {
  const n = Number(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

function trim(n) {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

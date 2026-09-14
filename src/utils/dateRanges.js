const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const quarterOfYear = require('dayjs/plugin/quarterOfYear');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(isoWeek);
dayjs.extend(quarterOfYear);
dayjs.extend(utc);
dayjs.extend(timezone);

// Railway (and most hosts) run the container clock in UTC. A bare dayjs()
// therefore rolls over to "tomorrow" as early as mid-afternoon Pacific /
// early evening Eastern, hours before it's actually the next day for the
// business - which is what made "Today's Sales" and "This Week's Sales"
// read $0 after a sale had genuinely just been entered: the dashboard was
// comparing against the wrong calendar day. Every "what day is it right
// now" check in the app should go through businessToday() instead of a
// bare dayjs() so they all agree with each other and with the business's
// actual clock. Override via BUSINESS_TIMEZONE if the business ever
// operates out of a different timezone.
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Toronto';

function businessToday() {
  return dayjs().tz(BUSINESS_TIMEZONE);
}

const FMT = 'YYYY-MM-DD';

function resolveRange(key, from, to) {
  const today = businessToday();
  switch (key) {
    case 'today':
      return { from: today.format(FMT), to: today.format(FMT), label: 'Today' };
    case 'yesterday': {
      const y = today.subtract(1, 'day');
      return { from: y.format(FMT), to: y.format(FMT), label: 'Yesterday' };
    }
    case 'this_week':
      return { from: today.startOf('isoWeek').format(FMT), to: today.format(FMT), label: 'This Week' };
    case 'last_week': {
      const lw = today.subtract(1, 'week');
      return { from: lw.startOf('isoWeek').format(FMT), to: lw.endOf('isoWeek').format(FMT), label: 'Last Week' };
    }
    case 'this_month':
      return { from: today.startOf('month').format(FMT), to: today.format(FMT), label: 'This Month' };
    case 'last_month': {
      const lm = today.subtract(1, 'month');
      return { from: lm.startOf('month').format(FMT), to: lm.endOf('month').format(FMT), label: 'Last Month' };
    }
    case 'this_quarter':
      return { from: today.startOf('quarter').format(FMT), to: today.format(FMT), label: 'This Quarter' };
    case 'this_year':
      return { from: today.startOf('year').format(FMT), to: today.format(FMT), label: 'This Year' };
    case 'custom':
      return { from: from || today.startOf('month').format(FMT), to: to || today.format(FMT), label: 'Custom Range' };
    default:
      return { from: today.startOf('month').format(FMT), to: today.format(FMT), label: 'This Month' };
  }
}

module.exports = { resolveRange, FMT, dayjs, businessToday, BUSINESS_TIMEZONE };

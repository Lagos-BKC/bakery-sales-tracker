const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const quarterOfYear = require('dayjs/plugin/quarterOfYear');
dayjs.extend(isoWeek);
dayjs.extend(quarterOfYear);

const FMT = 'YYYY-MM-DD';

function resolveRange(key, from, to) {
  const today = dayjs();
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

module.exports = { resolveRange, FMT, dayjs };

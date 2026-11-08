import assert from 'node:assert/strict';
import test from 'node:test';

let registration;
globalThis.window = {
  __ModuleLoader__: {
    load(next) {
      registration = next;
    }
  }
};

await import('../client.js');
delete globalThis.window;

const fakeReact = {
  createElement: () => null,
  useEffect: () => {},
  useMemo: () => {},
  useState: () => {}
};

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return fakeReact;
  throw new Error(`unexpected module: ${specifier}`);
});

const {
  HOLIDAYS,
  isPeakAt,
  offPeakReason,
  nextTransition,
  formatDuration,
  formatLocalTime,
  shortZoneLabel,
  normalizeZone,
  resolveZone,
  listTimeZones
} = plugin.__test;

const UTC = (...parts) => Date.UTC(...parts);
const t = (key, params = {}) => `${key}:${JSON.stringify(params)}`;

test('apply registers the dictionaries and the shell.bottom seat', () => {
  const seen = [];
  const ctx = {
    locale: {
      bind: () => t,
      register: (ns, dictionaries) => {
        seen.push(['locale', ns, Object.keys(dictionaries)]);
        return () => {};
      }
    },
    slots: {
      inject: (name, callback) => {
        seen.push(['inject', name]);
        const dispose = callback();
        assert.equal(typeof dispose, 'function');
        return () => {};
      },
      register: (options, component) => {
        seen.push(['register', options.name, options.locale, typeof component]);
        return () => {};
      }
    },
    effect: (callback) => {
      const dispose = callback();
      assert.equal(typeof dispose, 'function');
    }
  };

  plugin.apply(ctx);

  assert.deepEqual(seen, [
    ['locale', 'peakRateFooter', ['en', 'es', 'zh']],
    ['inject', 'shell.bottom'],
    ['register', 'shell.bottom', 'peakRateFooter', 'function']
  ]);
});

test('Chinese holiday ranges are expanded into dates', () => {
  assert.equal(HOLIDAYS.has('2026-02-15'), true);
  assert.equal(HOLIDAYS.has('2026-02-23'), true);
  assert.equal(HOLIDAYS.has('2026-02-24'), false);
  assert.equal(HOLIDAYS.has('2027-06-09'), true);
  assert.equal(HOLIDAYS.has('2027-06-10'), false);
});

test('peak windows are 01:00-04:00 and 06:00-10:00 UTC on weekdays', () => {
  // Monday 2026-11-09.
  assert.equal(isPeakAt(UTC(2026, 10, 9, 0, 59)), false);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 1, 0)), true);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 3, 59)), true);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 4, 0)), false);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 5, 59)), false);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 6, 0)), true);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 9, 59)), true);
  assert.equal(isPeakAt(UTC(2026, 10, 9, 10, 0)), false);
});

test('weekends are off-peak at every hour', () => {
  // Saturday 2026-11-07 and Sunday 2026-11-08.
  assert.equal(isPeakAt(UTC(2026, 10, 7, 2, 0)), false);
  assert.equal(isPeakAt(UTC(2026, 10, 7, 7, 0)), false);
  assert.equal(isPeakAt(UTC(2026, 10, 8, 2, 0)), false);
  assert.equal(offPeakReason(UTC(2026, 10, 7, 2, 0)), 'weekend');
});

test('Chinese public holidays are off-peak in full', () => {
  // National Day period: 2026-10-01 through 2026-10-07 (Thursday to Wednesday).
  assert.equal(isPeakAt(UTC(2026, 9, 1, 2, 0)), false);
  assert.equal(isPeakAt(UTC(2026, 9, 7, 7, 0)), false);
  assert.equal(offPeakReason(UTC(2026, 9, 1, 2, 0)), 'holiday');
  // The first weekday after the holiday is peak again.
  assert.equal(isPeakAt(UTC(2026, 9, 8, 2, 0)), true);
});

test('off-peak reason is null outside a holiday or weekend', () => {
  assert.equal(offPeakReason(UTC(2026, 10, 9, 0, 30)), null);
  assert.equal(offPeakReason(UTC(2026, 10, 9, 4, 30)), null);
});

test('next transition follows the current rate window', () => {
  assert.equal(nextTransition(UTC(2026, 10, 9, 2, 0)), UTC(2026, 10, 9, 4, 0));
  assert.equal(nextTransition(UTC(2026, 10, 9, 4, 30)), UTC(2026, 10, 9, 6, 0));
  assert.equal(nextTransition(UTC(2026, 10, 9, 10, 30)), UTC(2026, 10, 10, 1, 0));
});

test('next transition skips weekends and Chinese holidays', () => {
  // Saturday noon -> Monday 01:00 UTC.
  assert.equal(nextTransition(UTC(2026, 10, 7, 12, 0)), UTC(2026, 10, 9, 1, 0));
  // Inside the National Day holiday -> 2026-10-08 01:00 UTC.
  assert.equal(nextTransition(UTC(2026, 9, 1, 2, 0)), UTC(2026, 9, 8, 1, 0));
  // Friday after the last peak window -> Monday 01:00 UTC.
  assert.equal(nextTransition(UTC(2026, 9, 9, 10, 30)), UTC(2026, 9, 12, 1, 0));
});

test('duration formatting chooses the right granularity', () => {
  assert.equal(formatDuration(30_000, t), 'duration.lessThanMinute:{}');
  assert.equal(formatDuration(45 * 60_000, t), 'duration.minutes:{"minutes":45}');
  assert.equal(formatDuration(2 * 3_600_000, t), 'duration.hours:{"hours":2}');
  assert.equal(
    formatDuration(2 * 3_600_000 + 14 * 60_000, t),
    'duration.hoursMinutes:{"hours":2,"minutes":14}'
  );
  assert.equal(formatDuration(24 * 3_600_000, t), 'duration.days:{"days":1}');
  assert.equal(
    formatDuration(26 * 3_600_000, t),
    'duration.daysHours:{"days":1,"hours":2}'
  );
});

test('local time formatting honors the selected IANA zone', () => {
  const instant = UTC(2026, 10, 9, 2, 30);
  assert.equal(formatLocalTime(instant, 'America/Santiago', 'en'), '23:30');
  assert.equal(formatLocalTime(instant, 'Asia/Shanghai', 'en'), '10:30');
  assert.equal(formatLocalTime(instant, 'UTC', 'en'), '02:30');
  assert.equal(formatLocalTime(instant, 'Not/AZone', 'en'), '--:--');
});

test('zone labels and validation are defensive', () => {
  assert.equal(shortZoneLabel('America/Santiago'), 'Santiago');
  assert.equal(shortZoneLabel('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  assert.equal(shortZoneLabel('UTC'), 'UTC');
  assert.equal(normalizeZone('  Asia/Shanghai  '), 'Asia/Shanghai');
  assert.equal(normalizeZone('Not/AZone'), '');
  assert.equal(normalizeZone(''), '');
  assert.equal(resolveZone('Not/AZone'), Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.ok(listTimeZones().includes('UTC'));
  assert.ok(listTimeZones().includes('Asia/Shanghai'));
  assert.ok(listTimeZones().length > 10);
});

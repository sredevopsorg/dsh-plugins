window.__ModuleLoader__.load({
  id: '@sredevopsorg/dsh-peak-rate-footer',
  factory(require) {
    const React = require('react');
    const { useEffect, useMemo, useState } = React;
    const h = React.createElement;

    const NS = 'peakRateFooter';
    const STORAGE_KEY = 'dsh-peak-rate-footer.timeZone';

    /**
     * Chinese public holidays announced by the State Council, in China Standard
     * Time (UTC+8). Each entry is an inclusive date range. DeepSeek bills the
     * whole range as off-peak.
     *
     * Both peak windows (01:00-04:00 and 06:00-10:00 UTC) fall on the same
     * calendar date in China (09:00-12:00 and 14:00-18:00), so matching the UTC
     * date against these local dates is sufficient.
     *
     * 2025: https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm
     * 2026: https://www.gov.cn/zhengce/content/202511/content_7047090.htm
     * 2027: https://www.gov.cn/zhengce/content/202611/content_7085101.htm
     */
    const HOLIDAY_RANGES = [
      ['2025-01-01', '2025-01-01'], // New Year
      ['2025-01-28', '2025-02-04'], // Spring Festival
      ['2025-04-04', '2025-04-06'], // Qingming
      ['2025-05-01', '2025-05-05'], // Labor Day
      ['2025-05-31', '2025-06-02'], // Dragon Boat
      ['2025-10-01', '2025-10-08'], // National Day and Mid-Autumn
      ['2026-01-01', '2026-01-03'], // New Year
      ['2026-02-15', '2026-02-23'], // Spring Festival
      ['2026-04-04', '2026-04-06'], // Qingming
      ['2026-05-01', '2026-05-05'], // Labor Day
      ['2026-06-19', '2026-06-21'], // Dragon Boat
      ['2026-09-25', '2026-09-27'], // Mid-Autumn
      ['2026-10-01', '2026-10-07'], // National Day
      ['2027-01-01', '2027-01-03'], // New Year
      ['2027-02-05', '2027-02-13'], // Spring Festival
      ['2027-04-03', '2027-04-05'], // Qingming
      ['2027-05-01', '2027-05-05'], // Labor Day
      ['2027-06-09', '2027-06-09'], // Dragon Boat
      ['2027-09-15', '2027-09-15'], // Mid-Autumn
      ['2027-10-01', '2027-10-07'] // National Day
    ];

    const HOLIDAYS = new Set();
    for (const [start, end] of HOLIDAY_RANGES) {
      let day = Date.parse(`${start}T00:00:00Z`);
      const last = Date.parse(`${end}T00:00:00Z`);
      if (!Number.isFinite(day) || !Number.isFinite(last) || day > last) continue;
      while (day <= last) {
        HOLIDAYS.add(new Date(day).toISOString().slice(0, 10));
        day += 86400000;
      }
    }

    const PEAK_WINDOWS_UTC = [
      [60, 240], // 01:00-04:00
      [360, 600] // 06:00-10:00
    ];

    const COMMON_TIME_ZONES = [
      'UTC',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Asia/Kolkata',
      'Europe/London',
      'Europe/Berlin',
      'Europe/Paris',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Sao_Paulo',
      'America/Santiago',
      'Australia/Sydney',
      'Pacific/Auckland'
    ];

    const EN = {
      'status.peak': 'Peak rates',
      'status.offPeak': 'Off-peak rates',
      'reason.holiday': 'Chinese holiday',
      'reason.weekend': 'Weekend',
      'next.peakIn': 'Peak in {duration}',
      'next.offPeakIn': 'Off-peak in {duration}',
      'next.unknown': 'Next change unknown',
      'duration.lessThanMinute': 'less than a minute',
      'duration.days': '{days}d',
      'duration.daysHours': '{days}d {hours}h',
      'duration.hours': '{hours}h',
      'duration.hoursMinutes': '{hours}h {minutes}m',
      'duration.minutes': '{minutes}m',
      'timeZone.label': 'Time zone for the footer clock',
      'timeZone.title': 'Choose the time zone used for the clock. Rate status always follows UTC.',
      'timeZone.local': 'Local ({zone})',
      'footer.aria': 'DeepSeek API rate status: {status}. Local time {time} ({zone}). {next}',
      'schedule.title': 'DeepSeek API peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday, excluding Chinese public holidays. All other hours are off-peak.'
    };

    const ES = {
      'status.peak': 'Tarifas de hora punta',
      'status.offPeak': 'Tarifas de hora valle',
      'reason.holiday': 'Festivo chino',
      'reason.weekend': 'Fin de semana',
      'next.peakIn': 'Hora punta en {duration}',
      'next.offPeakIn': 'Hora valle en {duration}',
      'next.unknown': 'Próximo cambio desconocido',
      'duration.lessThanMinute': 'menos de un minuto',
      'duration.days': '{days} d',
      'duration.daysHours': '{days} d {hours} h',
      'duration.hours': '{hours} h',
      'duration.hoursMinutes': '{hours} h {minutes} min',
      'duration.minutes': '{minutes} min',
      'timeZone.label': 'Zona horaria del reloj del pie',
      'timeZone.title': 'Elige la zona horaria del reloj. El estado de tarifas siempre se calcula en UTC.',
      'timeZone.local': 'Local ({zone})',
      'footer.aria': 'Estado de tarifas de la API de DeepSeek: {status}. Hora local {time} ({zone}). {next}',
      'schedule.title': 'Horas punta de la API de DeepSeek: 01:00-04:00 y 06:00-10:00 UTC, de lunes a viernes, excluidos los festivos públicos chinos. El resto de horas son hora valle.'
    };

    const ZH = {
      'status.peak': '高峰费率',
      'status.offPeak': '低谷费率',
      'reason.holiday': '中国法定节假日',
      'reason.weekend': '周末',
      'next.peakIn': '距高峰 {duration}',
      'next.offPeakIn': '距低谷 {duration}',
      'next.unknown': '下次切换时间未知',
      'duration.lessThanMinute': '不到 1 分钟',
      'duration.days': '{days} 天',
      'duration.daysHours': '{days} 天 {hours} 小时',
      'duration.hours': '{hours} 小时',
      'duration.hoursMinutes': '{hours} 小时 {minutes} 分',
      'duration.minutes': '{minutes} 分',
      'timeZone.label': '页脚时钟时区',
      'timeZone.title': '选择页脚时钟使用的时区；费率状态始终按 UTC 计算。',
      'timeZone.local': '本地（{zone}）',
      'footer.aria': 'DeepSeek API 费率状态：{status}。本地时间 {time}（{zone}）。{next}',
      'schedule.title': 'DeepSeek API 高峰时段：UTC 周一至周五 01:00-04:00 和 06:00-10:00，中国法定节假日除外。其余时间均为低谷时段。'
    };

    const CSS = `
.dsh-prf {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
  padding: 3px 12px;
  font-family: var(--dsw-font-family);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--dsw-static-green-500) 16%, var(--dsw-alias-bg-base));
  border-top: 1px solid color-mix(in srgb, var(--dsw-static-green-500) 38%, transparent);
}
.dsh-prf[data-rate="peak"] {
  background: color-mix(in srgb, var(--dsw-static-amber-500) 22%, var(--dsw-alias-bg-base));
  border-top-color: color-mix(in srgb, var(--dsw-static-amber-500) 45%, transparent);
}
.dsh-prf__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-static-green-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-static-green-500) 18%, transparent);
}
.dsh-prf[data-rate="peak"] .dsh-prf__dot {
  background: var(--dsw-static-amber-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-static-amber-500) 20%, transparent);
}
.dsh-prf__status {
  font-weight: 600;
  white-space: nowrap;
}
.dsh-prf__reason {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dsh-prf__sep {
  color: var(--dsw-alias-label-tertiary);
}
.dsh-prf__clock {
  font-weight: 500;
  white-space: nowrap;
}
.dsh-prf__tz {
  appearance: none;
  max-width: 22ch;
  margin: 0;
  padding: 1px 14px 1px 4px;
  border: 0;
  border-radius: 4px;
  background-color: transparent;
  background-image:
    linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 8px) 55%, calc(100% - 4px) 55%;
  background-size: 4px 4px, 4px 4px;
  background-repeat: no-repeat;
  color: inherit;
  font: inherit;
  font-size: 11px;
  text-overflow: ellipsis;
  cursor: pointer;
}
.dsh-prf__tz:hover {
  background-color: color-mix(in srgb, currentColor 8%, transparent);
}
.dsh-prf__tz:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-prf__next {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dsh-prf__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 640px) {
  .dsh-prf__reason,
  .dsh-prf__next {
    display: none;
  }
}
`;

    function getBrowserZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        return 'UTC';
      }
    }

    function normalizeZone(value) {
      if (typeof value !== 'string') return '';
      const zone = value.trim();
      if (zone === '') return '';
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return zone;
      } catch {
        return '';
      }
    }

    function resolveZone(value) {
      const chosen = normalizeZone(value);
      return chosen === '' ? getBrowserZone() : chosen;
    }

    function readStoredZone() {
      try {
        return normalizeZone(globalThis.localStorage?.getItem(STORAGE_KEY));
      } catch {
        return '';
      }
    }

    function writeStoredZone(zone) {
      try {
        if (zone === '') globalThis.localStorage?.removeItem(STORAGE_KEY);
        else globalThis.localStorage?.setItem(STORAGE_KEY, zone);
      } catch {
        // A browser that refuses storage still lets the current page use the choice.
      }
    }

    function listTimeZones() {
      const zones = new Set(COMMON_TIME_ZONES);
      zones.add(getBrowserZone());
      try {
        if (typeof Intl.supportedValuesOf === 'function') {
          for (const zone of Intl.supportedValuesOf('timeZone')) zones.add(zone);
        }
      } catch {
        // The curated fallback above already makes the selector usable.
      }
      zones.delete('');
      return [...zones].sort((a, b) => a.localeCompare(b, 'en'));
    }

    function shortZoneLabel(zone) {
      if (typeof zone !== 'string' || zone === '') return 'UTC';
      const parts = zone.split('/');
      return parts[parts.length - 1].replace(/_/g, ' ');
    }

    function isHolidayDate(dateKey, extraHolidays) {
      if (HOLIDAYS.has(dateKey)) return true;
      return extraHolidays instanceof Set && extraHolidays.has(dateKey);
    }

    /**
     * Whether the given instant is billed at peak rates.
     * @param {number} time Epoch milliseconds.
     * @param {Set<string>} [extraHolidays] Extra YYYY-MM-DD Chinese-holiday dates.
     * @returns {boolean} True inside a peak window.
     */
    function isPeakAt(time, extraHolidays) {
      const date = new Date(time);
      if (Number.isNaN(date.getTime())) return false;
      const day = date.getUTCDay();
      if (day === 0 || day === 6) return false;
      const dateKey = date.toISOString().slice(0, 10);
      if (isHolidayDate(dateKey, extraHolidays)) return false;
      const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
      for (const [start, end] of PEAK_WINDOWS_UTC) {
        if (minute >= start && minute < end) return true;
      }
      return false;
    }

    /**
     * Why an off-peak instant is off-peak, when the reason is remarkable.
     * @param {number} time Epoch milliseconds.
     * @param {Set<string>} [extraHolidays] Extra YYYY-MM-DD Chinese-holiday dates.
     * @returns {'holiday'|'weekend'|null} The reason, or null outside peak windows.
     */
    function offPeakReason(time, extraHolidays) {
      const date = new Date(time);
      if (Number.isNaN(date.getTime())) return null;
      const dateKey = date.toISOString().slice(0, 10);
      if (isHolidayDate(dateKey, extraHolidays)) return 'holiday';
      const day = date.getUTCDay();
      if (day === 0 || day === 6) return 'weekend';
      return null;
    }

    /**
     * The next instant at which the billed rate changes.
     * @param {number} time Epoch milliseconds.
     * @param {Set<string>} [extraHolidays] Extra YYYY-MM-DD Chinese-holiday dates.
     * @returns {number|null} Epoch milliseconds, or null when none is found in 28 days.
     */
    function nextTransition(time, extraHolidays) {
      const current = isPeakAt(time, extraHolidays);
      const dayStart = new Date(time);
      dayStart.setUTCHours(0, 0, 0, 0);
      const start = dayStart.getTime();
      // Rate status can only change at these four window edges. A date change
      // at 00:00 UTC never changes it: 00:00 is always off-peak, so both sides
      // of midnight are off-peak even on a weekday.
      for (let offset = 0; offset <= 28; offset += 1) {
        for (const hour of [1, 4, 6, 10]) {
          const candidate = start + offset * 86400000 + hour * 3600000;
          if (candidate <= time) continue;
          if (isPeakAt(candidate, extraHolidays) !== current) return candidate;
        }
      }
      return null;
    }

    function formatDuration(ms, t) {
      const minutes = Math.max(0, Math.floor(ms / 60000));
      if (minutes < 1) return t('duration.lessThanMinute');
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const remainder = minutes % 60;
      if (days > 0) {
        return hours === 0
          ? t('duration.days', { days })
          : t('duration.daysHours', { days, hours });
      }
      if (hours > 0) {
        return remainder === 0
          ? t('duration.hours', { hours })
          : t('duration.hoursMinutes', { hours, minutes: remainder });
      }
      return t('duration.minutes', { minutes });
    }

    function formatLocalTime(time, zone, locale) {
      try {
        return new Intl.DateTimeFormat(locale, {
          timeZone: zone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23'
        }).format(new Date(time));
      } catch {
        return '--:--';
      }
    }

    function createFooter(ctx, t) {
      return function RateFooter() {
        const [now, setNow] = useState(() => Date.now());
        const [selectedZone, setSelectedZone] = useState(readStoredZone);
        const browserZone = useMemo(getBrowserZone, []);
        const zones = useMemo(() => {
          const listed = listTimeZones();
          if (selectedZone !== '' && !listed.includes(selectedZone)) listed.push(selectedZone);
          return listed;
        }, [selectedZone]);
        const zone = resolveZone(selectedZone);
        const locale = ctx.locale.getLocale().active;
        const peak = isPeakAt(now);
        const reason = peak ? null : offPeakReason(now);
        const next = nextTransition(now);
        const localTime = formatLocalTime(now, zone, locale);
        const statusText = peak ? t('status.peak') : t('status.offPeak');
        const reasonText = reason === null ? '' : t(`reason.${reason}`);
        const nextText = next === null
          ? t('next.unknown')
          : formatDuration(next - now, t);
        const nextLabel = next === null
          ? nextText
          : peak
            ? t('next.offPeakIn', { duration: nextText })
            : t('next.peakIn', { duration: nextText });
        const zoneLabel = selectedZone === ''
          ? t('timeZone.local', { zone: shortZoneLabel(browserZone) })
          : selectedZone;
        const selectWidth = Math.max(7, Math.min(24, zoneLabel.length + 2));
        const ariaStatus = reasonText === '' ? statusText : `${statusText}, ${reasonText}`;
        const ariaLabel = t('footer.aria', {
          status: ariaStatus,
          time: localTime,
          zone,
          next: nextLabel
        });

        useEffect(() => {
          setNow(Date.now());
          const timer = setInterval(() => setNow(Date.now()), 10000);
          return () => clearInterval(timer);
        }, []);

        const onZoneChange = (event) => {
          const value = normalizeZone(event.target.value);
          setSelectedZone(value);
          writeStoredZone(value);
          setNow(Date.now());
        };

        return h('div', {
          className: 'dsh-prf',
          'data-rate': peak ? 'peak' : 'off-peak',
          role: 'group',
          'aria-label': ariaLabel,
          title: t('schedule.title')
        },
          h('style', null, CSS),
          h('span', { className: 'dsh-prf__sr', role: 'status', 'aria-live': 'polite' }, statusText),
          h('span', { className: 'dsh-prf__dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dsh-prf__status' }, statusText),
          reasonText === '' ? null : h('span', { className: 'dsh-prf__reason' }, reasonText),
          h('span', { className: 'dsh-prf__sep', 'aria-hidden': 'true' }, '·'),
          h('span', { className: 'dsh-prf__clock' }, localTime),
          h('select', {
            className: 'dsh-prf__tz',
            value: selectedZone,
            onChange: onZoneChange,
            'aria-label': t('timeZone.label'),
            title: `${zone} — ${t('timeZone.title')}`,
            style: { width: `${selectWidth}ch` }
          },
            h('option', { value: '' }, t('timeZone.local', { zone: shortZoneLabel(browserZone) })),
            zones.map((zoneName) => h('option', { key: zoneName, value: zoneName }, zoneName))
          ),
          h('span', { className: 'dsh-prf__sep', 'aria-hidden': 'true' }, '·'),
          h('span', { className: 'dsh-prf__next' }, nextLabel)
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(
          () => ctx.locale.register(NS, { en: EN, es: ES, zh: ZH }),
          'dsh-peak-rate-footer: dictionaries'
        );
        const Footer = createFooter(ctx, t);
        ctx.effect(
          () => ctx.slots.inject('shell.bottom', () => ctx.slots.register({
            name: 'shell.bottom',
            locale: NS
          }, Footer)),
          'dsh-peak-rate-footer: bottom seat'
        );
      },
      __test: {
        HOLIDAY_RANGES,
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
      }
    };
  }
});

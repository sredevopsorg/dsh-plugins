# DeepSeek rate footer

A DSH Web profile bundle that adds a slim footer to the bottom of the Web GUI
showing whether DeepSeek API usage is billed at **peak** or **off-peak** rates.
The footer is green for off-peak and orange for peak.

It also shows the current local time and the next rate change, and lets you pick
the clock's time zone directly in the footer.

## What it does

- Evaluates DeepSeek's UTC schedule on every tick:
  - peak: `01:00-04:00` and `06:00-10:00` UTC, Monday through Friday,
    excluding Chinese public holidays;
  - off-peak: every other hour, including weekends and Chinese public holidays
    in full.
- Shows a green **Off-peak rates** bar or an orange **Peak rates** bar.
- Labels an off-peak weekend or Chinese public holiday, so an off-peak result
  inside a peak window is easy to understand.
- Shows the current time in the selected zone and a countdown to the next rate
  change (`Peak in 2h 14m`, `Off-peak in 3d 6h`, and similar).
- Lets you change the clock's IANA time zone from the selector beside the clock.
  The choice is stored in this browser's `localStorage`; the default follows the
  browser's local zone. The rate calculation itself always uses UTC.
- Follows the light/dark theme with DSH theme tokens and registers no Host route,
  tool, prompt section, or session event.

## Install

From a pinned release:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#peak-rate-footer-v0.1.0&path:/plugins/peak-rate-footer"
```

Or from a local checkout:

```bash
dsh plugin --profile web add ./plugins/peak-rate-footer
```

Refresh the Web GUI after installing. The plugin occupies the built-in
`shell.bottom` seat and appears immediately.

## Configuration

The clock's time zone is selected in the footer itself. Use the browser's local
zone (the default), UTC, or any IANA zone supported by the browser. The footer
stores the choice under `dsh-peak-rate-footer.timeZone` in `localStorage`.

The rate schedule is not configurable: it follows DeepSeek's published rule at
<https://api-docs.deepseek.com/quick_start/pricing/>.

### Holiday data

The bundle includes Chinese public holiday ranges for 2025, 2026, and 2027 from
the State Council notices:

- 2025: [国务院办公厅关于2025年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm)
- 2026: [国务院办公厅关于2026年部分节假日安排的通知](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)
- 2027: [国务院办公厅关于2027年部分节假日安排的通知](https://www.gov.cn/zhengce/content/202611/content_7085101.htm)

Adjusted make-up workdays are irrelevant to the rate schedule: those dates are
weekends, and weekends are already off-peak. After 2027, update `HOLIDAY_RANGES`
in [`client.js`](client.js) when the next State Council notice is published.

## Development

```sh
npm test        # schedule, holiday, transition, and time-zone tests
npm run check   # node --check on the package entry points and tests
```

The package is authored in this directory and installed with
`dsh plugin --profile web add ./plugins/peak-rate-footer`; the profile patch is
never edited by hand.

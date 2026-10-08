# FlareSolverr v1 API contract

Grounded in the upstream source (`src/flaresolverr.py`, `src/flaresolverr_service.py`,
`src/dtos.py`) and the official README. Cite those as the authority; this file is a distillation.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | Welcome payload: `{"msg": "FlareSolverr is ready!", "version": "3.5.2", "userAgent": "Mozilla/5.0 …"}`. The User-Agent here is the one the solver uses. |
| `GET /health` | Readiness probe: `{"status": "ok"}`. Deliberately does not log traces. |
| `POST /v1` | The command API. JSON request body, JSON response. |

A 404 anywhere returns JSON (`{"error": …, "status_code": …}`) rather than HTML.

## Request envelope

```json
{ "cmd": "request.get", "url": "https://example.com/", "maxTimeout": 60000 }
```

`cmd` is mandatory. An unknown `cmd` → `Request parameter 'cmd' = 'x' is invalid.`

Two parameters were removed in v2 and are ignored with a warning rather than rejected:
`headers` and `userAgent`. `returnRawHtml` and `download` were also removed.

## `request.get`

| Parameter | Type | Notes |
|---|---|---|
| `url` | string | **Required.** Rejected if absent. |
| `session` | string | Reuse an existing browser. Absent → a temporary browser is launched and destroyed for this call only. |
| `session_ttl_minutes` | integer | Automatically rotate the session after this many minutes. |
| `maxTimeout` | integer | Milliseconds to solve the challenge. Default `60000`. Values `< 1` or absent reset to the default. |
| `cookies` | array | `[{"name": "n", "value": "v"}]` — loaded into the browser before navigating, then the page is reloaded. |
| `returnOnlyCookies` | boolean | Omit `response` and `headers` from the solution. |
| `returnScreenshot` | boolean | Base64 PNG of the final rendered page in `solution.screenshot`. |
| `proxy` | object | `{"url": "http://…", "username": "…", "password": "…"}`. **Ignored when `session` is set** — set the proxy on `sessions.create` instead. |
| `waitInSeconds` | number | Seconds to wait after solving, before returning. For late-loading content. |
| `disableMedia` | boolean | Block images, CSS, and fonts via CDP. Faster and lighter. |
| `tabs_till_verify` | integer | Number of `Tab` presses needed to reach a Cloudflare Turnstile widget; the token is returned as `solution.turnstile_token`. **GET only.** |

Posting `postData` to `request.get` → `Cannot use 'postBody' when sending a GET request.`

## `request.post`

As `request.get`, plus:

| Parameter | Type | Notes |
|---|---|---|
| `postData` | string | **Required.** `application/x-www-form-urlencoded`, e.g. `a=b&c=d`. |

Missing `postData` → `Request parameter 'postData' is mandatory in 'request.post' command.`

`tabs_till_verify` is not supported for POST.

## Sessions

| `cmd` | Parameters | Behavior |
|---|---|---|
| `sessions.create` | `session` (optional id; a UUID is generated otherwise), `proxy` (optional) | Launches a browser that retains cookies. Reusing an existing id returns `"Session already exists."` rather than erroring. |
| `sessions.list` | — | `{"sessions": ["id1", "id2"]}`. |
| `sessions.destroy` | `session` | Shuts the browser down and removes its files. A missing session throws `The session doesn't exist.` |

Sessions speed up repeated requests because the browser is not relaunched, and they preserve
cookies. **They must be closed**: each one is a live browser holding memory.

## Response envelope

```json
{
  "solution": {
    "url": "https://example.com/",
    "status": 200,
    "headers": {},
    "response": "<!DOCTYPE html>…",
    "cookies": [
      {
        "name": "cf_clearance", "value": "…", "domain": ".example.com", "path": "/",
        "expires": 1610684149.307722, "size": 178,
        "httpOnly": true, "secure": true, "session": false, "sameSite": "None"
      }
    ],
    "userAgent": "Mozilla/5.0 (X11; Linux x86_64) …",
    "turnstile_token": "03AGdBq24k3lK7JH2v8uN1T5F…",
    "screenshot": "iVBORw0KG…"
  },
  "status": "ok",
  "message": "Challenge solved!",
  "startTimestamp": 1594872947467,
  "endTimestamp": 1594872949617,
  "version": "3.5.2"
}
```

Sessions commands answer with `session` and/or `sessions` at the top level instead of `solution`.

### Fields that mislead

- **`solution.status` is hardcoded to `200`.** Selenium does not expose the HTTP status, so this
  field is a placeholder — upstream marks it `todo: fix`. It tells you nothing about the target's
  real response.
- **`solution.headers` is an empty object** for the same reason.
- **`status: "ok"` at the top level means the command ran**, not that the challenge was solved.
  Read `message`: `Challenge solved!` versus `Challenge not detected!` versus an error.
- **`message` is the primary diagnostic.** On failure it carries the reason.

### Error responses

A failing command returns HTTP **500** with a *valid* JSON envelope carrying `status: "error"` and
the message. Reading the status before the body discards the only useful diagnostic — parse the
body first. Typical messages:

| Message | Cause |
|---|---|
| `Error solving the challenge. Timeout after N seconds.` | `maxTimeout` expired (`func_timeout`). |
| `Error solving the challenge. <detail>` | Underlying Selenium/browser failure. |
| `Cloudflare has blocked this request. Probably your IP is banned for this site, check in your web browser.` | The target returns an access-denied page, not a challenge. |
| `Captcha detected but no automatic solver is configured.` | Interactive CAPTCHA. No working solver exists upstream. |
| `Request parameter 'url' is mandatory in 'request.get' command.` | Missing `url`. |
| `The session doesn't exist.` | `sessions.destroy` with an unknown id. |

## How the challenge detection actually works

Useful when a target behaves unexpectedly. After navigation FlareSolverr checks:

- **Access denied** by title (`Access denied`, `Attention Required! | Cloudflare`) or by selector
  (`div.cf-error-title …`, `#cf-error-details …`) → throws the IP-ban error immediately.
- **Challenge present** by title (`Just a moment...`, `DDoS-Guard`) or by a set of selectors
  (`#cf-challenge-running`, `.ray_id`, `.attack-box`, `#cf-please-wait`, `#challenge-spinner`,
  `#trk_jschal_js`, `#turnstile-wrapper`, `.lds-ring`, and others). If none match, the page is
  returned as-is with `Challenge not detected!`.
- If a challenge is found it waits for the title and selectors to clear, clicking the verify
  checkbox when it times out, then waits for the redirect.

So a page that "should" have been challenged but returns immediately means detection did not match
— check whether the response is actually the final content.

## Environment variables

Container-side configuration, from the image:

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` adds request ids. |
| `LOG_FILE` | none | e.g. `/config/flaresolverr.log`. |
| `LOG_HTML` | `false` | Logs every proxied HTML body at debug level. Very noisy. |
| `PROXY_URL` | none | Overridden by a per-request or per-session proxy. |
| `PROXY_USERNAME` / `PROXY_PASSWORD` | none | Only applied when `PROXY_URL` is set. |
| `CAPTCHA_SOLVER` | none | Names an adapter in `/captcha`. Upstream: **none currently work**. |
| `TZ` | `UTC` | Logs and browser timezone. |
| `LANG` | none | Browser language, e.g. `en_GB`. |
| `HEADLESS` | `true` | `false` needs a display; not usable in a headless container. |
| `DISABLE_MEDIA` | `false` | Instance-wide default for `disableMedia`. |
| `BROWSER_WAIT_TIMEOUT` | `1` | Seconds to wait for an expected page state per attempt. Raise on slow hosts. |
| `TEST_URL` | `https://www.google.com` | **Startup probe target.** If it is blocked where you run, startup fails — set this. |
| `PORT` | `8191` | Listening port. |
| `HOST` | `0.0.0.0` | Listening interface. |
| `PROMETHEUS_ENABLED` | `false` | Enables the metrics exporter. |
| `PROMETHEUS_PORT` | `8192` | Exporter port. |

## Prometheus metrics

With `PROMETHEUS_ENABLED=true` and port 8192 published:

- `flaresolverr_request_total{domain,result}` — counter.
- `flaresolverr_request_created{domain,result}` — gauge.
- `flaresolverr_request_duration{domain}` — histogram (buckets at 0 s, 10 s, 25 s, 50 s, +Inf).

The plugin does not publish 8192 by default; expose it only if you actually scrape metrics.

## Upstream references

- Repository: <https://github.com/FlareSolverr/FlareSolverr>
- Container images: <https://hub.docker.com/r/flaresolverr/flaresolverr> and
  `ghcr.io/flaresolverr/flaresolverr`
- Supported platforms: `linux/386`, `linux/amd64`, `linux/arm/v7`, `linux/arm64`
- License: MIT

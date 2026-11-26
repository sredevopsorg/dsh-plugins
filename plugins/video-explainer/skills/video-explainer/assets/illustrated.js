/* Reusable Picture-Book Illustration & Animation Engine for /video-explainer (Mode: illustrated)
 * Exports:
 *   - window.StoryBrush: deterministic 2D noise, offscreen sprite/boil baker, cotton-rag paper tooth,
 *     opaque gouache fill, directional pastel/crayon fill, sinusoidal striped fabric ribbing,
 *     dry charcoal stroke, Gaussian blush stipple, multi-bristle dry-brush ribbon, and tapered hair locks.
 *   - window.IllustratedStage: deterministic Canvas2D compositor bound to ExplainerStage + words.json
 *     with automatic speech visemes, periodic eye blinks, handheld sway camera, deckle page wipe,
 *     and caption-safe hand-drawn pill labels.
 */
(function (global) {
  "use strict";
  if (global.StoryBrush && global.IllustratedStage) return;

  const TAU = Math.PI * 2;
  const spriteCache = new Map();
  const paperTileCache = new Map();
  const colorCache = new Map();

  const GRAD2 = (function () {
    const g = new Float32Array(32);
    for (let i = 0; i < 16; i++) {
      const a = (i * TAU) / 16;
      g[i * 2] = Math.cos(a);
      g[i * 2 + 1] = Math.sin(a);
    }
    return g;
  })();

  const PALETTE = Object.freeze({
    paperCream: "#FCFBF7",
    paperWarm: "#F4EDE0",
    paperKraft: "#E6DBC8",
    nightIndigo: "#0D162B",
    nightPrussian: "#14294A",
    nightVelvet: "#091022",
    charcoalInk: "#14171F",
    chalkWhite: "#F7F5EE",
    skinBase: "#F2C6B6",
    skinLight: "#F8D9CD",
    skinShadow: "#DDA492",
    blushRose: "#E57A84",
    nosePink: "#D94B82",
    hairInk: "#090E17",
    hairPrussian: "#12527A",
    cardiganPurple: "#7B4BB7",
    cardiganMustard: "#F2C22E",
    shirtBlue: "#5D93B8",
    sunGold: "#F6BD2B",
    coralRed: "#E04F5F",
    tealSea: "#2E9D96",
    cobaltSky: "#1D63B8",
  });

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smooth(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function env(t, t0, t1, fi, fo) {
    if (t <= t0 || t >= t1) return 0;
    const up = fi > 0 ? smooth((t - t0) / fi) : 1;
    const dn = fo > 0 ? smooth((t1 - t) / fo) : 1;
    return up * dn;
  }

  function hashStr(str) {
    let h = 2166136261 >>> 0;
    const s = String(str === undefined || str === null ? "" : str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function toSeed(seed) {
    if (seed === undefined || seed === null) return 1;
    if (typeof seed === "number" && Number.isFinite(seed)) {
      return (Math.floor(seed) >>> 0) || 0x9e3779b9;
    }
    return hashStr(String(seed)) || 0x9e3779b9;
  }

  function mulberry32(seed) {
    let a = toSeed(seed);
    const next = function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.gauss = function () {
      const u1 = Math.max(1e-7, next());
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * next());
    };
    next.range = function (lo, hi) {
      return lo + (hi - lo) * next();
    };
    return next;
  }

  function boilIndex(t, fps, frameCount, phaseSeed) {
    const rate = Number(fps) || 10;
    const n = Math.max(1, Math.floor(Number(frameCount) || 3));
    const off = phaseSeed ? (toSeed(phaseSeed) % 97) : 0;
    return (Math.floor(Math.max(0, Number(t) || 0) * rate) + off) % n;
  }

  function latticeHash(ix, iy, s) {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) & 15;
  }

  function gradDot(ix, iy, dx, dy, s) {
    const idx = latticeHash(ix, iy, s) << 1;
    return GRAD2[idx] * dx + GRAD2[idx + 1] * dy;
  }

  function noise2(x, y, seed) {
    const s = toSeed(seed === undefined ? 1 : seed);
    const nx = Number(x) || 0;
    const ny = Number(y) || 0;
    const ix = Math.floor(nx);
    const iy = Math.floor(ny);
    const fx = nx - ix;
    const fy = ny - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const n00 = gradDot(ix, iy, fx, fy, s);
    const n10 = gradDot(ix + 1, iy, fx - 1, fy, s);
    const n01 = gradDot(ix, iy + 1, fx, fy - 1, s);
    const n11 = gradDot(ix + 1, iy + 1, fx - 1, fy - 1, s);
    return clamp(lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142, -1, 1);
  }

  function fbm2(x, y, octaves, seed) {
    const oct = clamp(Math.round(octaves === undefined ? 3 : octaves), 1, 6);
    const s0 = toSeed(seed === undefined ? 1 : seed);
    let px = Number(x) || 0;
    let py = Number(y) || 0;
    let sum = 0, amp = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise2(px, py, (s0 + i * 1013) >>> 0);
      norm += amp;
      amp *= 0.5;
      const rx = (px * 0.8 - py * 0.6) * 2.02 + 17.3;
      const ry = (px * 0.6 + py * 0.8) * 2.02 - 11.7;
      px = rx;
      py = ry;
    }
    return norm > 0 ? clamp((sum / norm) * 1.16, -1, 1) : 0;
  }

  function noise01(x, y, octaves, seed) {
    return clamp(0.5 + 0.5 * fbm2(x, y, octaves, seed), 0, 1);
  }

  function toPt(p) {
    if (!p) return null;
    if (Array.isArray(p) && p.length >= 2) return { x: Number(p[0]) || 0, y: Number(p[1]) || 0 };
    if (typeof p === "object") return { x: Number(p.x) || 0, y: Number(p.y) || 0 };
    return null;
  }

  function normalizePts(pts) {
    if (!Array.isArray(pts)) return [];
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = toPt(pts[i]);
      if (pt) out.push(pt);
    }
    return out;
  }

  function parseColor(col) {
    const key = String(col || "#14171F").trim();
    if (colorCache.has(key)) return colorCache.get(key);
    let r = 20, g = 23, b = 31, a = 1;
    if (key.charCodeAt(0) === 35) {
      const hex = key.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        r = parseInt(hex[0] + hex[0], 16) || 0;
        g = parseInt(hex[1] + hex[1], 16) || 0;
        b = parseInt(hex[2] + hex[2], 16) || 0;
        if (hex.length === 4) a = (parseInt(hex[3] + hex[3], 16) || 255) / 255;
      } else if (hex.length >= 6) {
        r = parseInt(hex.slice(0, 2), 16) || 0;
        g = parseInt(hex.slice(2, 4), 16) || 0;
        b = parseInt(hex.slice(4, 6), 16) || 0;
        if (hex.length >= 8) a = (parseInt(hex.slice(6, 8), 16) || 255) / 255;
      }
    } else if (key.indexOf("rgb") === 0) {
      const m = key.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        r = clamp(Math.round(Number(m[0]) || 0), 0, 255);
        g = clamp(Math.round(Number(m[1]) || 0), 0, 255);
        b = clamp(Math.round(Number(m[2]) || 0), 0, 255);
        if (m.length >= 4) a = clamp(Number(m[3]), 0, 1);
      }
    }
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const parsed = { r: r, g: g, b: b, a: a, lum: lum };
    if (colorCache.size < 512) colorCache.set(key, parsed);
    return parsed;
  }

  function rgba(col, alphaMul) {
    const c = typeof col === "object" && col !== null && "r" in col ? col : parseColor(col);
    const al = clamp((c.a === undefined ? 1 : c.a) * (alphaMul === undefined ? 1 : alphaMul), 0, 1);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + al.toFixed(3) + ")";
  }

  function shiftPigment(col, amt) {
    const c = typeof col === "object" && col !== null && "r" in col ? col : parseColor(col);
    const k = clamp(amt, -1, 1);
    if (k >= 0) {
      return { r: Math.round(lerp(c.r, 255, k)), g: Math.round(lerp(c.g, 251, k)), b: Math.round(lerp(c.b, 242, k)), a: c.a, lum: clamp(lerp(c.lum, 0.98, k), 0, 1) };
    }
    const d = -k;
    return {
      r: Math.round(lerp(c.r, Math.max(12, c.r * 0.28 + 18), d)),
      g: Math.round(lerp(c.g, Math.max(10, c.g * 0.22 + 10), d)),
      b: Math.round(lerp(c.b, Math.max(18, c.b * 0.34 + 24), d)),
      a: c.a,
      lum: clamp(c.lum * (1 - d * 0.75), 0, 1),
    };
  }

  function makeCanvas(w, h) {
    const cw = Math.max(1, Math.ceil(Number(w) || 1));
    const ch = Math.max(1, Math.ceil(Number(h) || 1));
    if (typeof document !== "undefined" && document.createElement) {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      return c;
    }
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(cw, ch);
    throw new Error("StoryBrush requires HTMLCanvasElement or OffscreenCanvas");
  }

  function bake(key, w, h, drawFn, seed) {
    const k = String(key);
    const cw = Math.max(1, Math.ceil(Number(w) || 1));
    const ch = Math.max(1, Math.ceil(Number(h) || 1));
    if (spriteCache.has(k)) {
      const hit = spriteCache.get(k);
      if (hit.width === cw && hit.height === ch) return hit;
    }
    const c = makeCanvas(cw, ch);
    const ctx = c.getContext("2d");
    const s = toSeed(seed === undefined ? 1 : seed);
    if (typeof drawFn === "function") {
      ctx.save();
      drawFn(ctx, cw, ch, s);
      ctx.restore();
    }
    if (spriteCache.size > 400) spriteCache.delete(spriteCache.keys().next().value);
    spriteCache.set(k, c);
    return c;
  }

  function bakeBoil(key, frames, w, h, drawFn, seed) {
    const n = Math.max(1, Math.floor(Number(frames) || 3));
    const s0 = toSeed(seed === undefined ? 1 : seed);
    const list = [];
    for (let i = 0; i < n; i++) {
      const frameSeed = (s0 + i * 97) >>> 0;
      list.push(bake(String(key) + "__f" + i, w, h, function (ctx, cw, ch) {
        if (typeof drawFn === "function") drawFn(ctx, cw, ch, i, frameSeed);
      }, frameSeed));
    }
    return list;
  }

  function pickBoil(framesArr, t, fps, phaseSeed) {
    if (!Array.isArray(framesArr) || !framesArr.length) return null;
    return framesArr[boilIndex(t, fps === undefined ? 10 : fps, framesArr.length, phaseSeed)];
  }

  function getPaperTile(isDark, seed) {
    const key = (toSeed(seed) % 4) + (isDark ? "_d" : "_l");
    if (paperTileCache.has(key)) return paperTileCache.get(key);
    const S = 256;
    const c = makeCanvas(S, S);
    const g = c.getContext("2d");
    const rng = mulberry32(key);
    const speckCount = 520;
    g.fillStyle = isDark ? "rgba(10, 16, 34, 0.24)" : "rgba(215, 205, 192, 0.32)";
    g.beginPath();
    for (let i = 0; i < speckCount; i++) g.rect(rng() * S, rng() * S, 0.7 + rng() * 1.4, 0.7 + rng() * 1.4);
    g.fill();
    g.fillStyle = isDark ? "rgba(235, 242, 255, 0.12)" : "rgba(255, 255, 255, 0.48)";
    g.beginPath();
    for (let i = 0; i < speckCount; i++) g.rect(rng() * S, rng() * S, 0.6 + rng() * 1.3, 0.6 + rng() * 1.3);
    g.fill();
    paperTileCache.set(key, c);
    return c;
  }

  function paperGrain(ctx, w, h, baseHex, toothAlpha, seed) {
    if (!ctx) return;
    const cw = Math.max(1, Math.ceil(Number(w) || 1920));
    const ch = Math.max(1, Math.ceil(Number(h) || 1080));
    const tAlpha = clamp(toothAlpha === undefined ? 0.16 : Number(toothAlpha), 0, 1);
    const s = toSeed(seed === undefined ? 1 : seed);
    let isDark = false;
    ctx.save();
    if (baseHex !== "transparent" && baseHex !== "none") {
      const hex = baseHex || PALETTE.paperCream;
      const baseCol = parseColor(hex);
      isDark = baseCol.lum < 0.38;
      const lin = ctx.createLinearGradient(0, 0, cw * 0.35, ch);
      lin.addColorStop(0, rgba(shiftPigment(baseCol, isDark ? 0.04 : 0.22), 1));
      lin.addColorStop(0.55, hex);
      lin.addColorStop(1, rgba(shiftPigment(baseCol, isDark ? -0.12 : -0.03), 1));
      ctx.fillStyle = lin;
      ctx.fillRect(0, 0, cw, ch);
    }
    if (tAlpha > 0.005) {
      const pat = ctx.createPattern(getPaperTile(isDark, s), "repeat");
      if (pat) {
        ctx.globalAlpha *= clamp(tAlpha * 1.4, 0, 1);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, cw, ch);
      }
    }
    ctx.restore();
  }

  function wobblePoints(pathPts, wobble, seed, close) {
    const raw = normalizePts(pathPts);
    const isClosed = close !== false;
    if (raw.length < (isClosed ? 3 : 2)) return raw;
    const wob = Math.max(0, wobble === undefined ? 2.0 : Number(wobble));
    const s = toSeed(seed === undefined ? 1 : seed);
    const out = [];
    const count = isClosed ? raw.length : raw.length - 1;
    let arcDist = 0;
    for (let i = 0; i < count; i++) {
      const a = raw[i], b = raw[(i + 1) % raw.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 0.001) continue;
      const nx = -dy / segLen, ny = dx / segLen;
      const steps = wob > 0.02 ? clamp(Math.ceil(segLen / 10), 1, 40) : 1;
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        const bx = a.x + dx * u, by = a.y + dy * u;
        if (wob > 0.02) {
          const disp = wob * (fbm2(bx * 0.021, by * 0.021, 3, s) * 0.78 + fbm2((arcDist + segLen * u) * 0.075, 4.1, 2, s + 911) * 0.42);
          out.push({ x: bx + nx * disp, y: by + ny * disp });
        } else {
          out.push({ x: bx, y: by });
        }
      }
      arcDist += segLen;
    }
    if (!isClosed && raw.length >= 2) out.push(raw[raw.length - 1]);
    return out;
  }

  function tracePoly(ctx, pts, close) {
    if (!pts || !pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close !== false) ctx.closePath();
  }

  function boundsOf(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), cx: (minX + maxX) * 0.5, cy: (minY + maxY) * 0.5 };
  }

  function drawEdgeTooth(ctx, wpts, close, baseCol, toothAmt, spreadPx, seed, alpha) {
    if (toothAmt <= 0.01 || wpts.length < 2) return;
    const rng = mulberry32((seed + 4409) >>> 0);
    const edgeCount = close !== false ? wpts.length : wpts.length - 1;
    ctx.fillStyle = rgba(baseCol, alpha * 0.85);
    ctx.beginPath();
    for (let i = 0; i < edgeCount; i++) {
      const a = wpts[i], b = wpts[(i + 1) % wpts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      const nx = -dy / len, ny = dx / len;
      const steps = Math.max(1, Math.floor(len / 1.8));
      for (let k = 0; k < steps; k++) {
        if (rng() > toothAmt) continue;
        const u = (k + rng()) / steps;
        const offN = (rng() - 0.4) * spreadPx;
        const gx = a.x + dx * u + nx * offN;
        const gy = a.y + dy * u + ny * offN;
        const r = 0.65 + rng() * 1.35;
        ctx.rect(gx - r, gy - r * 0.8, r * 2, r * 1.6);
      }
    }
    ctx.fill();
  }

  function renderPastelInterior(ctx, b, baseCol, angle, density, tooth, alpha, s, o) {
    const rng = mulberry32((s + 109) >>> 0);
    const shadowCol = o.shadowColor ? parseColor(o.shadowColor) : shiftPigment(baseCol, -0.17);
    const altCol = o.altColor ? parseColor(o.altColor) : shiftPigment(baseCol, 0.15);
    const paperCol = o.paperColor ? parseColor(o.paperColor) : (baseCol.lum < 0.21 ? shiftPigment(baseCol, 0.42) : { r: 253, g: 252, b: 248, a: 1, lum: 0.99 });

    const wash = ctx.createLinearGradient(b.minX, b.minY, b.maxX, b.maxY);
    wash.addColorStop(0, rgba(altCol, alpha * 0.16));
    wash.addColorStop(0.55, rgba(baseCol, 0));
    wash.addColorStop(1, rgba(shadowCol, alpha * 0.18));
    ctx.fillStyle = wash;
    ctx.fillRect(b.minX - 2, b.minY - 2, b.w + 4, b.h + 4);

    const area = Math.max(64, b.w * b.h);
    const hatchCount = clamp(Math.round((area / 52) * density), 12, 1200);
    const span = clamp(Math.sqrt(area) * 0.42, 10, 64);
    ctx.lineCap = "round";
    for (let wp = 0; wp < 2; wp++) {
      ctx.lineWidth = wp === 0 ? 1.0 : 1.85;
      ctx.strokeStyle = wp === 0 ? rgba(shadowCol, alpha * 0.22) : rgba(altCol, alpha * 0.22);
      ctx.beginPath();
      for (let i = wp; i < hatchCount; i += 2) {
        const cx = b.minX + rng() * b.w, cy = b.minY + rng() * b.h;
        const aJit = angle + (rng() - 0.5) * 0.28;
        const hl = span * (0.35 + rng() * 0.65) * 0.5;
        const dx = Math.cos(aJit) * hl, dy = Math.sin(aJit) * hl;
        const arch = (rng() - 0.5) * 4.0;
        ctx.moveTo(cx - dx, cy - dy);
        ctx.quadraticCurveTo(cx - Math.sin(aJit) * arch, cy + Math.cos(aJit) * arch, cx + dx, cy + dy);
      }
      ctx.stroke();
    }

    if (tooth > 0.015) {
      const candidates = clamp(Math.round((area / 18) * tooth), 32, 2600);
      ctx.fillStyle = rgba(paperCol, alpha * clamp(tooth * 1.35, 0.14, 0.72));
      ctx.beginPath();
      for (let i = 0; i < candidates; i++) {
        const px = b.minX + rng() * b.w, py = b.minY + rng() * b.h;
        if (noise01(px * 0.045, py * 0.045, 2, (s + 11) >>> 0) <= 0.42) continue;
        const r = (0.65 + rng() * 1.35) * (0.8 + tooth * 0.4);
        ctx.rect(px - r, py - r * 0.7, r * 2, r * 1.4);
      }
      ctx.fill();
    }
  }

  function gouacheFill(ctx, pathPts, color, opts) {
    if (!ctx || !pathPts) return;
    const o = opts || {};
    const alpha = clamp(o.alpha === undefined ? 1 : Number(o.alpha), 0, 1);
    const s = toSeed(o.seed === undefined ? 1 : o.seed);
    const wpts = wobblePoints(pathPts, o.wobble === undefined ? 2.2 : o.wobble, s, true);
    if (wpts.length < 3) return;
    const baseCol = parseColor(color);
    const poolCol = o.poolColor ? parseColor(o.poolColor) : shiftPigment(baseCol, -0.20);
    const b = boundsOf(wpts);
    ctx.save();
    ctx.fillStyle = rgba(baseCol, alpha);
    tracePoly(ctx, wpts, true);
    ctx.fill();
    ctx.save();
    tracePoly(ctx, wpts, true);
    ctx.clip();
    const maxR = Math.max(12, Math.hypot(b.w, b.h) * 0.55);
    const g = ctx.createRadialGradient(b.cx, b.cy, maxR * 0.15, b.cx, b.cy, maxR);
    g.addColorStop(0, rgba(shiftPigment(baseCol, 0.16), alpha * 0.09));
    g.addColorStop(0.65, rgba(poolCol, 0));
    g.addColorStop(1, rgba(poolCol, alpha * 0.16));
    ctx.fillStyle = g;
    ctx.fillRect(b.minX - 4, b.minY - 4, b.w + 8, b.h + 8);
    ctx.restore();
    drawEdgeTooth(ctx, wpts, true, baseCol, clamp(o.tooth === undefined ? 0.35 : o.tooth, 0, 1), 3.2, s, alpha);
    ctx.restore();
  }

  function fillPastel(ctx, pathPts, color, opts) {
    if (!ctx || !pathPts) return;
    const o = opts || {};
    const alpha = clamp(o.alpha === undefined ? 1 : Number(o.alpha), 0, 1);
    const tooth = clamp(o.tooth === undefined ? 0.32 : Number(o.tooth), 0, 1);
    const s = toSeed(o.seed === undefined ? 1 : o.seed);
    const wpts = wobblePoints(pathPts, o.wobble === undefined ? 1.8 : o.wobble, s, true);
    if (wpts.length < 3) return;
    const baseCol = parseColor(color);
    const b = boundsOf(wpts);
    ctx.save();
    ctx.fillStyle = rgba(baseCol, alpha * clamp(0.95 - tooth * 0.15, 0.75, 0.96));
    tracePoly(ctx, wpts, true);
    ctx.fill();
    ctx.save();
    tracePoly(ctx, wpts, true);
    ctx.clip();
    renderPastelInterior(ctx, b, baseCol, Number(o.angle || 0), clamp(Number(o.density || 1), 0.3, 2.6), tooth, alpha, s, o);
    ctx.restore();
    drawEdgeTooth(ctx, wpts, true, baseCol, clamp(0.4 + tooth * 0.85, 0.25, 1), 3.8 + tooth * 3, s, alpha);
    ctx.restore();
  }

  function fillStriped(ctx, pathPts, colors, opts) {
    if (!ctx || !pathPts) return;
    const o = opts || {};
    const palette = Array.isArray(colors) && colors.length ? colors : [PALETTE.cardiganMustard, PALETTE.cardiganPurple];
    const alpha = clamp(o.alpha === undefined ? 1 : Number(o.alpha), 0, 1);
    const tooth = clamp(o.tooth === undefined ? 0.34 : Number(o.tooth), 0, 1);
    const s = toSeed(o.seed === undefined ? 1 : o.seed);
    const wpts = wobblePoints(pathPts, o.wobble === undefined ? 2.0 : o.wobble, s, true);
    if (wpts.length < 3) return;
    const b = boundsOf(wpts);
    const bandH = Math.max(8, Number(o.stripeHeight || 34));
    const waveAmp = o.waveAmp === undefined ? bandH * 0.15 : Number(o.waveAmp);
    const waveFreq = (Math.PI * 1.35) / Math.max(40, b.w);
    const tilt = Number(o.stripeAngle || 0);
    const ribAngle = tilt + Math.PI * 0.5;
    const pad = Math.max(24, Math.abs(Math.sin(tilt)) * b.w + waveAmp * 2 + 12);
    const yStart = b.minY - pad, yEnd = b.maxY + pad;
    const nBands = clamp(Math.ceil((yEnd - yStart) / bandH), 1, 64);
    const xSteps = clamp(Math.ceil(b.w / 16), 8, 40);

    function edgeRow(idx) {
      const yBase = yStart + idx * bandH;
      const row = new Array(xSteps + 1);
      for (let k = 0; k <= xSteps; k++) {
        const x = b.minX - 16 + (b.w + 32) * (k / xSteps);
        const sag = Math.sin((x - b.cx) * waveFreq + idx * 0.35) * waveAmp;
        row[k] = { x: x, y: yBase + sag + (x - b.cx) * Math.tan(tilt) + 2 * fbm2(x * 0.025, idx * 1.7, 2, s + idx * 131) };
      }
      return row;
    }

    ctx.save();
    tracePoly(ctx, wpts, true);
    ctx.clip();
    let top = edgeRow(0);
    for (let bi = 0; bi < nBands; bi++) {
      const bot = edgeRow(bi + 1);
      const poly = top.concat(bot.slice().reverse());
      const baseCol = parseColor(palette[bi % palette.length]);
      const bb = boundsOf(poly);
      ctx.save();
      ctx.fillStyle = rgba(baseCol, alpha * 0.95);
      tracePoly(ctx, poly, true);
      ctx.fill();
      tracePoly(ctx, poly, true);
      ctx.clip();
      renderPastelInterior(ctx, bb, baseCol, ribAngle, 1.1, tooth, alpha, (s + bi * 353) >>> 0, o);
      ctx.restore();
      drawEdgeTooth(ctx, top, false, baseCol, tooth * 0.85, 3.0, (s + bi * 577) >>> 0, alpha);
      top = bot;
    }
    ctx.restore();
    drawEdgeTooth(ctx, wpts, true, parseColor(palette[0]), 0.65, 4.0, s, alpha * 0.85);
  }

  function crayonStroke(ctx, pts, color, width, roughness, seed, opts) {
    if (!ctx || !pts) return;
    const raw = normalizePts(pts);
    if (raw.length < 2) return;
    const o = opts || {};
    const w = Math.max(0.7, width === undefined ? 6 : Number(width));
    const rgh = clamp(roughness === undefined ? 0.5 : Number(roughness), 0, 1.2);
    const s = toSeed(seed === undefined ? 1 : seed);
    const alpha = clamp(o.alpha === undefined ? 1 : Number(o.alpha), 0, 1);
    const baseCol = parseColor(color);
    const wpts = wobblePoints(raw, w * 0.22 * rgh, s, false);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let st = 0; st < 3; st++) {
      const lane = (st - 1) * w * 0.24;
      ctx.lineWidth = Math.max(0.8, w * (st === 1 ? 0.62 : 0.38));
      ctx.strokeStyle = rgba(st === 2 ? shiftPigment(baseCol, -0.15) : baseCol, alpha * (st === 1 ? 0.82 : 0.52));
      ctx.beginPath();
      let down = false;
      for (let i = 0; i < wpts.length; i++) {
        if (rgh > 0.2 && noise2(i * 0.35, st * 3.1, s + st * 97) < -0.55 + rgh * 0.35) {
          down = false;
          continue;
        }
        const px = wpts[i].x + lane, py = wpts[i].y + lane * 0.5;
        if (!down) { ctx.moveTo(px, py); down = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    drawEdgeTooth(ctx, wpts, false, baseCol, clamp(0.35 + rgh * 0.5, 0.2, 0.95), w * 0.7, s, alpha * 0.75);
    ctx.restore();
  }

  function drawBlush(ctx, cx, cy, rx, ry, color, density, seed, opts) {
    if (!ctx) return;
    const o = opts || {};
    const radX = Math.max(1, Number(rx) || 28), radY = Math.max(1, Number(ry) || 22);
    const d = clamp(density === undefined ? 1 : Number(density), 0.1, 3);
    const s = toSeed(seed === undefined ? 1 : seed);
    const innerAlpha = clamp(o.innerAlpha === undefined ? 0.65 : Number(o.innerAlpha), 0, 1);
    const baseCol = parseColor(color || PALETTE.blushRose);
    const rng = mulberry32(s);
    ctx.save();
    ctx.translate(Number(cx) || 0, Number(cy) || 0);
    if (o.angle) ctx.rotate(Number(o.angle));
    ctx.save();
    ctx.scale(radX, radY);
    const g = ctx.createRadialGradient(0, 0, 0.02, 0, 0, 1.05);
    g.addColorStop(0, rgba(baseCol, innerAlpha * 0.42));
    g.addColorStop(0.55, rgba(baseCol, innerAlpha * 0.18));
    g.addColorStop(1, rgba(baseCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1.05, 0, TAU);
    ctx.fill();
    ctx.restore();

    const count = clamp(Math.round(900 * d), 120, 2800);
    ctx.fillStyle = rgba(baseCol, innerAlpha * 0.48);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const th = rng() * TAU;
      const dist = Math.abs(rng.gauss()) * 0.48;
      if (dist > 1.35) continue;
      const r = (0.55 + rng() * 0.9) * (1.15 - dist * 0.45);
      ctx.rect(Math.cos(th) * radX * dist, Math.sin(th) * radY * dist, r, r);
    }
    ctx.fill();
    ctx.restore();
  }

  function evalBezier(p0, p1, p2, p3, t) {
    const mt = 1 - t, mt2 = mt * mt, t2 = t * t;
    const x = mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x;
    const y = mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y;
    const dx = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
    const dy = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);
    const len = Math.hypot(dx, dy) || 1;
    return { x: x, y: y, tx: dx / len, ty: dy / len, nx: -dy / len, ny: dx / len };
  }

  function drawDryRibbon(ctx, p0, p1, p2, p3, wStart, wEnd, color, bristles, seed, opts) {
    if (!ctx) return;
    const b0 = toPt(p0), b1 = toPt(p1), b2 = toPt(p2), b3 = toPt(p3);
    if (!b0 || !b1 || !b2 || !b3) return;
    const o = opts || {};
    const ws = Math.max(0.5, Number(wStart || 18)), we = Math.max(0.2, Number(wEnd || 3));
    const count = clamp(Math.round(Number(bristles || 16)), 4, 48);
    const s = toSeed(seed === undefined ? 1 : seed);
    const dryness = clamp(o.dryness === undefined ? 0.26 : Number(o.dryness), 0, 0.95);
    const alpha = clamp(o.alpha === undefined ? 0.9 : Number(o.alpha), 0, 1);
    const baseCol = parseColor(color);
    const steps = 28;
    const samples = new Array(steps + 1);
    for (let k = 0; k <= steps; k++) samples[k] = evalBezier(b0, b1, b2, b3, k / steps);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = clamp(((ws + we) * 0.5) / (count * 0.45), 0.85, Math.max(2.2, ws * 0.32));
    ctx.strokeStyle = rgba(baseCol, alpha);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const fRng = mulberry32((s + i * 733) >>> 0);
      const uLane = (i / Math.max(1, count - 1)) * 2 - 1 + (fRng() - 0.5) * 0.18;
      let down = false;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        if (dryness > 0.02 && t > 0.1 && fRng() < dryness * (0.3 + t * 0.9) * (0.4 + Math.abs(uLane) * 0.75) * 0.5) {
          down = false;
          continue;
        }
        const sp = samples[k];
        const wHere = o.knifeTip ? lerp(we, ws, Math.pow(1 - t, 0.82)) : lerp(ws, we, Math.pow(t, 0.85));
        const px = sp.x + sp.nx * uLane * wHere * 0.5;
        const py = sp.y + sp.ny * uLane * wHere * 0.5;
        if (!down) { ctx.moveTo(px, py); down = true; }
        else ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function wispyHair(ctx, p0, p1, p2, p3, color, width, seed) {
    const b0 = toPt(p0), b1 = toPt(p1), b2 = toPt(p2), b3 = toPt(p3);
    if (!ctx || !b0 || !b1 || !b2 || !b3) return;
    const s = toSeed(seed === undefined ? 1 : seed);
    ctx.save();
    ctx.strokeStyle = rgba(parseColor(color || PALETTE.hairInk), 0.82);
    ctx.lineWidth = Math.max(0.6, Number(width || 1.0));
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const sp = evalBezier(b0, b1, b2, b3, t);
      const jit = 1.6 * fbm2(t * 5.2, 2.3, 2, s);
      const px = sp.x + sp.nx * jit, py = sp.y + sp.ny * jit;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawHairLock(ctx, p0, p1, p2, p3, widthStart, color, opts) {
    const b0 = toPt(p0), b1 = toPt(p1), b2 = toPt(p2), b3 = toPt(p3);
    if (!ctx || !b0 || !b1 || !b2 || !b3) return;
    const o = opts || {};
    const ws = Math.max(2, Number(widthStart || 28));
    const s = toSeed(o.seed === undefined ? 1 : o.seed);
    const alpha = clamp(o.alpha === undefined ? 0.98 : Number(o.alpha), 0, 1);
    const left = [], right = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const sp = evalBezier(b0, b1, b2, b3, t);
      const r = ws * 0.5 * Math.pow(1 - t, 0.82);
      left.push({ x: sp.x + sp.nx * r, y: sp.y + sp.ny * r });
      right.push({ x: sp.x - sp.nx * r, y: sp.y - sp.ny * r });
    }
    const poly = left.concat(right.reverse());
    const baseCol = parseColor(color || PALETTE.hairInk);
    ctx.save();
    ctx.fillStyle = rgba(baseCol, alpha);
    tracePoly(ctx, poly, true);
    ctx.fill();
    drawEdgeTooth(ctx, poly, true, baseCol, 0.5, 2.4, s, alpha * 0.85);
    if (o.highlightColor !== false) {
      drawDryRibbon(ctx, evalBezier(b0, b1, b2, b3, 0.06), b1, b2, evalBezier(b0, b1, b2, b3, 0.88),
        ws * 0.5, Math.max(0.8, ws * 0.06), o.highlightColor || PALETTE.hairPrussian, 12, s + 211,
        { dryness: 0.42, alpha: alpha * 0.76, knifeTip: true });
    }
    if (o.flyaways !== 0) {
      const rng = mulberry32(s + 883);
      const tip = evalBezier(b0, b1, b2, b3, 1);
      for (let f = 0; f < (o.flyaways || 2); f++) {
        const root = evalBezier(b0, b1, b2, b3, 0.3 + rng() * 0.4);
        const side = (rng() - 0.5) * ws * 0.7;
        wispyHair(ctx, root, { x: lerp(root.x, b2.x, 0.5) + root.nx * side, y: lerp(root.y, b2.y, 0.5) + root.ny * side },
          b3, { x: tip.x + tip.tx * (8 + rng() * 18) + tip.nx * side, y: tip.y + tip.ty * (8 + rng() * 18) + tip.ny * side },
          color || PALETTE.hairInk, 0.9, s + 1201 + f * 97);
      }
    }
    ctx.restore();
  }

  function normToken(w) {
    return String(w || "").toLowerCase().replace(/[^\w]+/g, "");
  }

  function classifyViseme(wordText, progress) {
    const w = normToken(wordText);
    if (!w) return { viseme: "rest", openness: 0, mouthWidth: 0.5 };
    const shapeEnv = Math.sin(clamp(progress, 0, 1) * Math.PI);
    if (/^[mbp]/.test(w) && progress < 0.28) return { viseme: "closed", openness: 0.06, mouthWidth: 0.48 };
    if (/oo|ou|ow|o|u|qu|w/.test(w)) return { viseme: "oh", openness: 0.55 * shapeEnv + 0.18, mouthWidth: 0.36 };
    if (/ee|ea|ie|i|y/.test(w) && !/igh|ir/.test(w)) return { viseme: "ee", openness: 0.42 * shapeEnv + 0.14, mouthWidth: 0.68 };
    return { viseme: "ah", openness: 0.66 * shapeEnv + 0.16, mouthWidth: 0.56 };
  }

  function mountIllustratedStage(compId, canvasSel, opts) {
    opts = opts || {};
    const data = global.__EXPLAINER_DATA__ || { width: 1920, height: 1080, fps: 30, duration: 60, scenes: [], words: [] };
    const W = Number(opts.width || data.width || 1920);
    const H = Number(opts.height || data.height || 1080);
    const duration = Number(opts.duration || data.duration || 60);
    const safeBottomY = opts.safeBottomY || (H > W ? H - 520 : H - 250);

    const canvas = typeof canvasSel === "string" ? document.querySelector(canvasSel) : canvasSel;
    if (canvas) {
      // The painted canvas is the whole film, so tell the layout audit a full-frame cover is intended.
      canvas.setAttribute("data-layout-allow-occlusion", "");
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas ? canvas.getContext("2d") : null;
    const expStage = global.ExplainerStage.create(compId || "world-comp", { width: W, height: H, duration: duration, drift: false });
    expStage.setDrift(false);

    const scenes = (data.scenes || []).map(function (s, idx) {
      const st = Number(s.start || 0), en = Number(s.end || duration);
      return { id: s.id, index: idx, start: st, end: en, dur: Math.max(0.033, en - st) };
    });
    const words = (data.words || []).map(function (w) {
      return { text: String(w.text || ""), norm: normToken(w.text), start: Number(w.start || 0), end: Number(w.end || 0) };
    });

    const paperFinish = bake("__ill_finish_" + W + "x" + H, W, H, function (g, cw, ch) {
      const rng = mulberry32(20261115);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rng() > 0.48 ? "rgba(255,252,244,0.20)" : "rgba(42,34,26,0.12)";
        const r = 0.6 + rng() * 1.4;
        g.fillRect(rng() * cw, rng() * ch, r, r);
      }
      const vig = g.createRadialGradient(cw * 0.5, ch * 0.48, ch * 0.36, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.64);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(24,18,12,0.15)");
      g.fillStyle = vig;
      g.fillRect(0, 0, cw, ch);
    });

    function scene(id) {
      for (let i = 0; i < scenes.length; i++) if (scenes[i].id === id) return scenes[i];
      return scenes[0] || { id: id || "s01", index: 0, start: 0, end: duration, dur: duration };
    }

    function sceneAt(t) {
      const tc = clamp(t, 0, duration);
      let sc = scenes[scenes.length - 1] || { id: "s01", index: 0, start: 0, end: duration, dur: duration };
      for (let i = 0; i < scenes.length; i++) {
        if (tc < scenes[i].end || i === scenes.length - 1) { sc = scenes[i]; break; }
      }
      const localT = clamp(tc - sc.start, 0, sc.dur);
      return { id: sc.id, index: sc.index, start: sc.start, end: sc.end, dur: sc.dur, localT: localT, progress: clamp(localT / sc.dur, 0, 1) };
    }

    function speechAt(t) {
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const p0 = w.start - 0.025, p1 = w.end + 0.035;
        if (t >= p0 && t <= p1) {
          const p = clamp((t - p0) / Math.max(0.06, p1 - p0), 0, 1);
          const v = classifyViseme(w.text, p);
          const bounce = 0.78 + 0.22 * Math.sin(t * (w.text.length >= 7 ? 11.5 : 7.5) * TAU);
          return { speaking: true, word: w.text, viseme: v.viseme, openness: clamp(v.openness * bounce, 0, 1), mouthWidth: v.mouthWidth, progress: p };
        }
      }
      return { speaking: false, word: "", viseme: "rest", openness: 0, mouthWidth: 0.5, progress: 0 };
    }

    function blinkAt(t, seed) {
      const off = (toSeed(seed || 1) % 37) * 0.11;
      const cycle = (t + off) % 3.6;
      if (cycle > 3.44) return Math.sin(((cycle - 3.44) / 0.16) * Math.PI);
      return 0;
    }

    function withCamera(targetCtx, camSpec, drawFn) {
      const c = camSpec || {};
      const t = Number(c.t || 0);
      const drift = c.drift === undefined ? 1 : Number(c.drift);
      const swayX = (Math.sin(t * 0.73) * 4.5 + Math.sin(t * 1.41 + 1.2) * 2.0) * drift;
      const swayY = (Math.cos(t * 0.61 + 0.7) * 3.4 + Math.sin(t * 1.19 + 2.4) * 1.6) * drift;
      const swayScale = 1 + Math.sin(t * 0.53 + 0.9) * 0.006 * drift;
      const sh = Number(c.shake || 0);
      const sc = Number(c.scale || 1) * swayScale;
      targetCtx.save();
      targetCtx.translate(W * 0.5 + swayX + (sh ? Math.sin(t * 91.7) * sh : 0), H * 0.5 + swayY + (sh ? Math.cos(t * 107.3) * sh * 0.8 : 0));
      targetCtx.scale(sc, sc);
      if (c.rot) targetCtx.rotate(Number(c.rot));
      targetCtx.translate(-W * 0.5 - Number(c.x || 0), -H * 0.5 - Number(c.y || 0));
      drawFn(targetCtx);
      targetCtx.restore();
    }

    function pageWipe(targetCtx, progress, bgHex, seed) {
      const p = clamp(progress, 0, 1);
      if (p <= 0.001) return;
      const xEdge = lerp(W + 80, -80, smooth(p));
      const s = toSeed(seed || 77);
      targetCtx.save();
      targetCtx.beginPath();
      targetCtx.moveTo(W + 100, -40);
      targetCtx.lineTo(xEdge, -40);
      for (let y = 0; y <= H + 40; y += 24) {
        targetCtx.lineTo(xEdge + fbm2(y * 0.018, 2.7, 3, s) * 26, y);
      }
      targetCtx.lineTo(W + 100, H + 40);
      targetCtx.closePath();
      targetCtx.clip();
      paperGrain(targetCtx, W, H, bgHex || PALETTE.paperCream, 0.16, s);
      targetCtx.restore();
    }

    function drawLabel(targetCtx, text, x, y, lopts) {
      if (!targetCtx || !text) return;
      const o = lopts || {};
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.01) return;
      const size = Math.max(28, Number(o.size || 38));
      const safeY = Math.min(safeBottomY - size * 0.7, Number(y || 140));
      const padX = o.padX === undefined ? 24 : o.padX, padY = o.padY === undefined ? 12 : o.padY;
      targetCtx.save();
      targetCtx.globalAlpha *= alpha;
      targetCtx.translate(x, safeY);
      if (o.rot) targetCtx.rotate(Number(o.rot));
      targetCtx.font = "800 " + size + 'px "Ftitle", Georgia, serif';
      targetCtx.textAlign = "center";
      targetCtx.textBaseline = "middle";
      const bw = targetCtx.measureText(text).width + padX * 2, bh = size + padY * 2;
      if (o.pill !== false) {
        targetCtx.fillStyle = "rgba(12, 16, 28, 0.22)";
        targetCtx.beginPath();
        targetCtx.roundRect(-bw * 0.5 + 4, -bh * 0.5 + 5, bw, bh, 12);
        targetCtx.fill();
        targetCtx.fillStyle = o.bg || PALETTE.paperCream;
        targetCtx.strokeStyle = o.border || PALETTE.charcoalInk;
        targetCtx.lineWidth = 2.8;
        targetCtx.beginPath();
        targetCtx.roundRect(-bw * 0.5, -bh * 0.5, bw, bh, 12);
        targetCtx.fill();
        targetCtx.stroke();
      }
      targetCtx.fillStyle = o.fg || PALETTE.charcoalInk;
      targetCtx.fillText(text, 0, 2);
      targetCtx.restore();
    }

    const drawCallbacks = [];
    const api = {
      W: W,
      H: H,
      SAFE_BOTTOM_Y: safeBottomY,
      palette: PALETTE,
      brush: global.StoryBrush,
      stage: expStage,
      clamp: clamp,
      lerp: lerp,
      smooth: smooth,
      env: env,
      mulberry32: mulberry32,
      boilIndex: boilIndex,
      scene: scene,
      sceneAt: sceneAt,
      cue: expStage.cue,
      speechAt: speechAt,
      blinkAt: blinkAt,
      withCamera: withCamera,
      pageWipe: pageWipe,
      drawLabel: drawLabel,
      onDraw: function (fn) { if (typeof fn === "function") drawCallbacks.push(fn); return api; },
      finalize: function () { expStage.finalize(); return api; },
    };

    expStage.onTick(function (t) {
      if (!ctx) return;
      const tc = clamp(Number(t || 0), 0, duration);
      const frame = {
        ctx: ctx,
        W: W,
        H: H,
        t: tc,
        scene: sceneAt(tc),
        speech: speechAt(tc),
        palette: PALETTE,
        brush: global.StoryBrush,
        stage: api,
        safeBottomY: safeBottomY,
      };
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let i = 0; i < drawCallbacks.length; i++) drawCallbacks[i](frame);
      if (opts.paperOverlay !== false) {
        ctx.globalAlpha = opts.paperOverlayAlpha === undefined ? 0.38 : opts.paperOverlayAlpha;
        ctx.drawImage(paperFinish, 0, 0, W, H);
      }
      ctx.restore();
    });

    return api;
  }

  global.StoryBrush = {
    palette: PALETTE,
    clamp: clamp,
    lerp: lerp,
    smooth: smooth,
    env: env,
    hashStr: hashStr,
    mulberry32: mulberry32,
    boilIndex: boilIndex,
    noise2: noise2,
    fbm2: fbm2,
    noise01: noise01,
    bake: bake,
    bakeBoil: bakeBoil,
    pickBoil: pickBoil,
    paperGrain: paperGrain,
    drawPaper: paperGrain,
    gouacheFill: gouacheFill,
    fillPastel: fillPastel,
    crayonPoly: fillPastel,
    fillStriped: fillStriped,
    crayonStroke: crayonStroke,
    drawBlush: drawBlush,
    stippleCloud: drawBlush,
    drawDryRibbon: drawDryRibbon,
    bristleRibbon: drawDryRibbon,
    drawHairLock: drawHairLock,
    wispyHair: wispyHair,
  };

  global.IllustratedStage = {
    palette: PALETTE,
    mount: mountIllustratedStage,
    create: mountIllustratedStage,
  };
})(typeof window !== "undefined" ? window : globalThis);

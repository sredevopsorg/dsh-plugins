/* Reusable Continuous Motion-Graphics Engine for /video-explainer
 * Provides:
 *   - Deterministic GSAP timeline + HyperFrames hf-seek synchronization
 *   - Continuous handheld/cinematic camera drift (sway, breathing scale, micro-rotation)
 *   - Word-exact syllable cue lookup from window.__EXPLAINER_DATA__ (words.json)
 *   - 3D multi-plane virtual camera rig (#cam, #cam-pivot, #cam-shake + [data-parallax])
 *   - High-energy choreography helpers (whipTo, zoomThrough, drawStroke, highlightSweep, stampSlam, kineticPunch, kenBurns)
 *   - Organic Kurzgesagt SVG generators (boiling solar flares, scalloped clouds)
 *   - Multi-theme parallax backdrop renderers: cosmos (default), paper, and blueprint
 */
(function (global) {
  "use strict";
  if (global.ExplainerStage) return;

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

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function wrapCoord(v, span, margin) {
    return ((v % span) + span) % span - margin;
  }

  function normWord(w) {
    return String(w || "").toLowerCase().replace(/[^\w]+/g, "");
  }

  function measureSvgLength(el) {
    if (!el) return 1200;
    if (typeof el.getTotalLength === "function") {
      try {
        const raw = el.getTotalLength();
        if (raw && isFinite(raw) && raw > 0) return Math.ceil(raw);
      } catch (_) {
        // Fallback when SVG element is detached or hidden
      }
    }
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "line") {
      const x1 = parseFloat(el.getAttribute("x1") || "0");
      const y1 = parseFloat(el.getAttribute("y1") || "0");
      const x2 = parseFloat(el.getAttribute("x2") || "0");
      const y2 = parseFloat(el.getAttribute("y2") || "0");
      const d = Math.hypot(x2 - x1, y2 - y1);
      if (d > 0) return Math.ceil(d);
    } else if (tag === "circle") {
      const r = parseFloat(el.getAttribute("r") || "0");
      if (r > 0) return Math.ceil(2 * Math.PI * r);
    }
    return 1200;
  }

  function createStage(compId, opts) {
    opts = opts || {};
    const data = global.__EXPLAINER_DATA__ || { width: 1920, height: 1080, fps: 30, duration: 60, scenes: [], words: [] };
    const duration = Number(opts.duration || data.duration || 60);
    const W = Number(opts.width || data.width || 1920);
    const H = Number(opts.height || data.height || 1080);

    global.__timelines = global.__timelines || {};
    const tl = global.gsap.timeline({
      paused: true,
      defaults: { immediateRender: false },
    });

    const camSel = opts.cam || "#cam";
    const pivotSel = opts.pivot || "#cam-pivot";
    const shakeSel = opts.shake || "#cam-shake";

    // Camera state tracked directly so parallax planes and canvas backdrops read exact camera pose on every seek
    const camPose = { x: 0, y: 0, scale: 1, rot: 0 };
    const viewPose = { x: 0, y: 0, scale: 1, rot: 0 };
    const driftCfg = {
      enabled: opts.drift !== false,
      swayX: 10,
      swayY: 7,
      scale: 0.018,
      rot: 0.22,
      speed: 1.0,
    };
    const tickCallbacks = [];
    const shakeEvents = [];

    function setDrift(cfg) {
      if (cfg === false) {
        driftCfg.enabled = false;
        return stage;
      }
      if (cfg === true) {
        driftCfg.enabled = true;
        return stage;
      }
      if (cfg && typeof cfg === "object") {
        if (cfg.enabled !== undefined) driftCfg.enabled = Boolean(cfg.enabled);
        else driftCfg.enabled = true;
        if (cfg.swayX !== undefined) driftCfg.swayX = Number(cfg.swayX);
        else if (cfg.x !== undefined) driftCfg.swayX = Number(cfg.x);
        if (cfg.swayY !== undefined) driftCfg.swayY = Number(cfg.swayY);
        else if (cfg.y !== undefined) driftCfg.swayY = Number(cfg.y);
        if (cfg.scale !== undefined) driftCfg.scale = Number(cfg.scale);
        else if (cfg.breath !== undefined) driftCfg.scale = Number(cfg.breath);
        if (cfg.rot !== undefined) driftCfg.rot = Number(cfg.rot);
        else if (cfg.rotation !== undefined) driftCfg.rot = Number(cfg.rotation);
        if (cfg.speed !== undefined) driftCfg.speed = Number(cfg.speed);
      }
      return stage;
    }

    function scene(sid) {
      const found = (data.scenes || []).find((s) => s.id === sid);
      return found || { id: sid, start: 0, end: duration };
    }

    function cue(sid, phrase, fallbackOffset) {
      const sc = scene(sid);
      const fb = sc.start + (typeof fallbackOffset === "number" ? fallbackOffset : (sc.end - sc.start) * 0.3);
      if (!phrase) return sc.start + (fallbackOffset || 0);
      const targets = String(phrase).split(/\s+/).map(normWord).filter(Boolean);
      const words = (data.words || []).filter((w) => w.end > sc.start && w.start < sc.end);
      if (!targets.length || !words.length) return clamp(fb, sc.start, sc.end);
      const toks = words.map((w) => normWord(w.text));
      const k = targets.length;
      for (let i = 0; i <= toks.length - k; i++) {
        let match = true;
        for (let j = 0; j < k; j++) {
          if (toks[i + j] !== targets[j]) { match = false; break; }
        }
        if (match) return words[i].start;
      }
      for (let i = 0; i < toks.length; i++) {
        if (toks[i].startsWith(targets[0]) || toks[i].includes(targets[0])) {
          return words[i].start;
        }
      }
      return clamp(fb, sc.start, sc.end);
    }

    function camInit(pose) {
      Object.assign(camPose, { x: 0, y: 0, scale: 1, rot: 0 }, pose || {});
      global.gsap.set(camSel, { x: -camPose.x, y: -camPose.y });
      global.gsap.set(pivotSel, { scale: camPose.scale, rotation: camPose.rot });
      return stage;
    }

    function camTo(t, target) {
      target = target || {};
      const dur = target.dur !== undefined ? target.dur : 1.1;
      const ease = target.ease || "power3.inOut";
      const poseVars = { duration: dur, ease: ease };
      const camVars = { duration: dur, ease: ease };
      const pivVars = { duration: dur, ease: ease };
      let moveCam = false, movePiv = false;

      if (target.x !== undefined) { poseVars.x = target.x; camVars.x = -target.x; moveCam = true; }
      if (target.y !== undefined) { poseVars.y = target.y; camVars.y = -target.y; moveCam = true; }
      if (target.scale !== undefined) { poseVars.scale = target.scale; pivVars.scale = target.scale; movePiv = true; }
      if (target.rot !== undefined) { poseVars.rot = target.rot; pivVars.rotation = target.rot; movePiv = true; }

      tl.to(camPose, poseVars, t);
      if (moveCam) tl.to(camSel, camVars, t);
      if (movePiv) tl.to(pivotSel, pivVars, t);
      return stage;
    }

    function whipTo(t, target) {
      const cfg = Object.assign({ dur: 0.55, ease: "expo.inOut" }, target || {});
      return camTo(t, cfg);
    }

    function zoomThrough(t, target) {
      target = target || {};
      const peakScale = target.peakScale !== undefined ? target.peakScale : 4.5;
      const dur = target.dur !== undefined ? target.dur : 0.85;
      const hasPortal = target.toX !== undefined || target.toY !== undefined || target.toScale !== undefined;

      if (hasPortal) {
        const inDur = dur * 0.56;
        const outDur = Math.max(0.12, dur - inDur);
        const diveVars = { scale: peakScale, dur: inDur, ease: target.easeIn || "expo.in" };
        if (target.x !== undefined) diveVars.x = target.x;
        if (target.y !== undefined) diveVars.y = target.y;
        if (target.rot !== undefined) diveVars.rot = target.rot;
        camTo(t, diveVars);

        const emergeT = t + inDur;
        const nextScale = target.toScale !== undefined ? target.toScale : 1.0;
        const fromEmergeScale = target.emergeFromScale !== undefined ? target.emergeFromScale : 0.42;
        if (target.toX !== undefined) {
          tl.set(camPose, { x: target.toX }, emergeT);
          tl.set(camSel, { x: -target.toX }, emergeT);
        }
        if (target.toY !== undefined) {
          tl.set(camPose, { y: target.toY }, emergeT);
          tl.set(camSel, { y: -target.toY }, emergeT);
        }
        tl.set(camPose, { scale: fromEmergeScale }, emergeT);
        tl.set(pivotSel, { scale: fromEmergeScale }, emergeT);
        camTo(emergeT + 0.001, {
          scale: nextScale,
          rot: target.toRot !== undefined ? target.toRot : 0,
          dur: outDur,
          ease: target.easeOut || "expo.out",
        });
        return stage;
      }

      const diveOnly = {
        scale: peakScale,
        dur: dur,
        ease: target.ease || "expo.inOut",
      };
      if (target.x !== undefined) diveOnly.x = target.x;
      if (target.y !== undefined) diveOnly.y = target.y;
      if (target.rot !== undefined) diveOnly.rot = target.rot;
      return camTo(t, diveOnly);
    }

    function shake(t, dur, intensity) {
      shakeEvents.push({ t0: t, t1: t + (dur || 0.45), amp: intensity || 14 });
      return stage;
    }

    function popIn(sel, t, cfg) {
      cfg = cfg || {};
      const dur = cfg.dur || 0.48;
      const fromScale = cfg.fromScale !== undefined ? cfg.fromScale : 0.72;
      const targets = global.gsap.utils.toArray(sel);
      targets.forEach(function (el) {
        const baseX = Number(global.gsap.getProperty(el, "x")) || 0;
        const baseY = Number(global.gsap.getProperty(el, "y")) || 0;
        const dy = cfg.y || 0;
        global.gsap.set(el, { autoAlpha: 0, scale: fromScale, x: baseX, y: baseY + dy, transformOrigin: "50% 50%" });
        tl.to(el, {
          autoAlpha: 1,
          scale: 1,
          x: baseX,
          y: baseY,
          duration: dur,
          ease: cfg.ease || "back.out(1.55)",
        }, t);
      });
      return stage;
    }

    function fadeOut(sel, t, dur) {
      tl.to(sel, { autoAlpha: 0, duration: dur || 0.35, ease: "power2.inOut" }, t);
      return stage;
    }

    function implode(sel, t, cfg) {
      cfg = cfg || {};
      const swellDur = cfg.swellDur || 0.16;
      const snapDur = cfg.snapDur || 0.24;
      const swellScale = cfg.swellScale || 1.12;
      const endScale = cfg.endScale !== undefined ? cfg.endScale : 0.08;
      tl.to(sel, { scale: swellScale, duration: swellDur, ease: "power2.out" }, Math.max(0, t - swellDur));
      tl.to(sel, { scale: endScale, duration: snapDur, ease: "power4.in" }, t);
      if (cfg.shake !== false) {
        shake(t + snapDur * 0.65, cfg.shakeDur || 0.42, cfg.shakeAmp || 16);
      }
      return stage;
    }

    function drawStroke(sel, t, dur, ease) {
      let d = 0.75;
      let e = "power2.inOut";
      if (dur && typeof dur === "object") {
        d = dur.dur !== undefined ? dur.dur : 0.75;
        e = dur.ease || "power2.inOut";
      } else {
        if (typeof dur === "number") d = dur;
        if (typeof ease === "string") e = ease;
      }
      const targets = global.gsap.utils.toArray(sel);
      targets.forEach(function (el) {
        const len = measureSvgLength(el);
        global.gsap.set(el, {
          autoAlpha: 0,
          strokeDasharray: len,
          strokeDashoffset: len,
        });
        tl.to(el, { autoAlpha: 1, duration: Math.min(0.05, d * 0.2), ease: "none" }, t);
        tl.to(el, { strokeDashoffset: 0, duration: d, ease: e }, t);
      });
      return stage;
    }

    function highlightSweep(sel, t, dur) {
      let d = 0.48;
      let ease = "power2.out";
      if (dur && typeof dur === "object") {
        d = dur.dur !== undefined ? dur.dur : 0.48;
        ease = dur.ease || "power2.out";
      } else if (typeof dur === "number") {
        d = dur;
      }
      const targets = global.gsap.utils.toArray(sel);
      targets.forEach(function (el, idx) {
        if (!el) return;
        const host = el.classList && el.classList.contains("st-hl-bar") ? el.parentElement : el;
        if (!host) return;
        global.gsap.set(host, { backgroundSize: "0% 100%" });
        tl.to(host, { backgroundSize: "100% 100%", duration: d, ease: ease }, t + idx * 0.08);
      });
      return stage;
    }

    function stampSlam(sel, t, cfg) {
      cfg = cfg || {};
      const dur = cfg.dur !== undefined ? cfg.dur : 0.22;
      const rot = cfg.rot !== undefined ? cfg.rot : -6;
      const fromScale = cfg.fromScale !== undefined ? cfg.fromScale : 2.4;
      const targets = global.gsap.utils.toArray(sel);
      targets.forEach(function (el, idx) {
        const ti = t + idx * (cfg.stagger || 0);
        global.gsap.set(el, {
          autoAlpha: 0,
          scale: fromScale,
          rotation: rot - 6,
          transformOrigin: "50% 50%",
        });
        tl.to(el, {
          autoAlpha: 1,
          scale: 1,
          rotation: rot,
          duration: dur,
          ease: cfg.ease || "power4.in",
        }, ti);
      });
      if (cfg.shake !== false) {
        shake(t + 0.18, cfg.shakeDur || 0.32, cfg.shakeAmp || 12);
      }
      return stage;
    }

    function kineticPunch(sel, t, cfg) {
      cfg = cfg || {};
      const dur = cfg.dur !== undefined ? cfg.dur : 0.34;
      const stagger = cfg.stagger !== undefined ? cfg.stagger : 0.09;
      const fromScale = cfg.fromScale !== undefined ? cfg.fromScale : 1.5;
      const dy = cfg.y !== undefined ? cfg.y : (cfg.fromScale !== undefined ? 0 : 50);
      const ease = cfg.ease || "expo.out";
      const targets = global.gsap.utils.toArray(sel);
      targets.forEach(function (el, idx) {
        const ti = t + idx * stagger;
        const baseX = Number(global.gsap.getProperty(el, "x")) || 0;
        const baseY = Number(global.gsap.getProperty(el, "y")) || 0;
        global.gsap.set(el, {
          autoAlpha: 0,
          scale: fromScale,
          x: baseX,
          y: baseY + dy,
          transformOrigin: "50% 50%",
        });
        tl.to(el, {
          autoAlpha: 1,
          scale: 1,
          x: baseX,
          y: baseY,
          duration: dur,
          ease: ease,
        }, ti);
        if (cfg.hold !== undefined && cfg.hold > 0) {
          const exitT = ti + dur + Number(cfg.hold);
          tl.to(el, {
            autoAlpha: 0,
            scale: cfg.exitScale !== undefined ? cfg.exitScale : 0.88,
            y: baseY - 26,
            duration: cfg.exitDur || 0.26,
            ease: "power2.in",
          }, exitT);
        }
      });
      if (cfg.shake) {
        shake(t + dur * 0.45, cfg.shakeDur || 0.26, cfg.shakeAmp || 10);
      }
      return stage;
    }

    function kenBurns(sel, t0, t1, cfg) {
      cfg = cfg || {};
      const start = Number(t0) || 0;
      const dur = (typeof t1 === "number" && t1 > start)
        ? (t1 - start)
        : (typeof t1 === "number" && t1 > 0 ? t1 : (cfg.dur || 6));
      const fromScale = cfg.fromScale !== undefined ? cfg.fromScale : 1.0;
      const toScale = cfg.toScale !== undefined ? cfg.toScale : 1.14;
      const dx = cfg.dx !== undefined ? cfg.dx : -18;
      const dy = cfg.dy !== undefined ? cfg.dy : -10;
      const fromX = cfg.fromX || 0;
      const fromY = cfg.fromY || 0;
      const origin = cfg.origin || "50% 50%";

      const targets = global.gsap.utils.toArray(sel);
      targets.forEach(function (el) {
        if (!el) return;
        let mediaEl = el;
        const tag = String(el.tagName || "").toLowerCase();
        if (!cfg.self && tag !== "img" && tag !== "video" && el.querySelector) {
          const inner = el.querySelector("img, video");
          if (inner) {
            mediaEl = inner;
            const parent = inner.parentElement;
            if (parent && parent.classList && parent.classList.contains("st-clipping")) {
              parent.style.overflow = "hidden";
            }
          }
        }
        tl.fromTo(mediaEl, {
          scale: fromScale,
          x: fromX,
          y: fromY,
          transformOrigin: origin,
        }, {
          scale: toScale,
          x: fromX + dx,
          y: fromY + dy,
          duration: Math.max(0.1, dur),
          ease: cfg.ease || "none",
          immediateRender: false,
        }, start);
      });
      return stage;
    }

    function counter(sel, fromVal, toVal, t, dur, formatFn) {
      const el = typeof sel === "string" ? document.querySelector(sel) : sel;
      if (!el) return stage;
      const state = { v: fromVal };
      tl.fromTo(state, { v: fromVal }, {
        v: toVal,
        duration: dur || 0.6,
        ease: "power2.out",
        onUpdate: function () {
          el.textContent = formatFn ? formatFn(state.v) : state.v.toFixed(2);
        },
      }, t);
      return stage;
    }

    function scallopPath(cx, cy, r, lobes, amp, phase) {
      const n = Math.max(6, lobes || 16);
      const pts = [];
      const steps = n * 6;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const wave = Math.sin(a * n + phase) * amp + Math.cos(a * (n * 0.5) - phase * 1.3) * (amp * 0.42);
        const rr = r + wave;
        pts.push((cx + Math.cos(a) * rr).toFixed(1) + "," + (cy + Math.sin(a) * rr).toFixed(1));
      }
      return "M" + pts.join("L") + "Z";
    }

    function coronaFlares(cx, cy, r, count, height, phase) {
      let d = "";
      const n = count || 8;
      for (let i = 0; i < n; i++) {
        const baseA = (i / n) * Math.PI * 2 + phase * 0.28;
        const pulse = 0.55 + 0.45 * Math.sin(phase * 2.1 + i * 1.7);
        const h = height * pulse;
        const spread = 0.14 + 0.04 * pulse;
        const x1 = cx + Math.cos(baseA - spread) * (r - 2);
        const y1 = cy + Math.sin(baseA - spread) * (r - 2);
        const x2 = cx + Math.cos(baseA + spread) * (r - 2);
        const y2 = cy + Math.sin(baseA + spread) * (r - 2);
        const bend = baseA + 0.12 * Math.sin(phase * 1.5 + i);
        const xm = cx + Math.cos(bend) * (r + h);
        const ym = cy + Math.sin(bend) * (r + h);
        d += `M${x1.toFixed(1)},${y1.toFixed(1)} Q${xm.toFixed(1)},${ym.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} `;
      }
      return d;
    }

    function _buildCosmosRenderer(ctx, rng, cfg) {
      const nebulae = [
        { x: 380, y: 260, r: 520, c0: "rgba(56, 189, 248, 0.11)", c1: "rgba(99, 102, 241, 0.04)" },
        { x: 1480, y: 320, r: 580, c0: "rgba(168, 85, 247, 0.10)", c1: "rgba(236, 72, 153, 0.03)" },
        { x: 2450, y: 520, r: 620, c0: "rgba(14, 165, 233, 0.11)", c1: "rgba(59, 130, 246, 0.03)" },
        { x: 3450, y: 980, r: 640, c0: "rgba(245, 158, 11, 0.09)", c1: "rgba(139, 92, 246, 0.04)" },
      ];
      const farStars = Array.from({ length: 210 }, () => ({
        x: rng() * 3400 - 500,
        y: rng() * 2200 - 400,
        r: 0.7 + rng() * 1.5,
        hue: rng() < 0.25 ? "#bae6fd" : rng() < 0.5 ? "#fde68a" : "#f8fafc",
        tw: rng() * Math.PI * 2,
        sp: 0.9 + rng() * 1.8,
      }));
      const midStars = Array.from({ length: 95 }, () => ({
        x: rng() * 4400 - 700,
        y: rng() * 2600 - 500,
        r: 1.3 + rng() * 2.1,
        hue: rng() < 0.35 ? "#7dd3fc" : rng() < 0.65 ? "#fef08a" : "#e2e8f0",
        tw: rng() * Math.PI * 2,
        sp: 1.2 + rng() * 2.1,
        spike: rng() > 0.78,
      }));
      const fgMotes = Array.from({ length: 42 }, () => ({
        x: rng() * 5600 - 900,
        y: rng() * 3200 - 700,
        r: 2.2 + rng() * 4.2,
        alpha: 0.08 + rng() * 0.16,
        hue: rng() < 0.5 ? "125, 211, 252" : "253, 224, 71",
        drift: rng() * Math.PI * 2,
      }));

      return function drawCosmos(t) {
        ctx.clearRect(0, 0, W, H);
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, "#050814");
        bg.addColorStop(0.55, "#090f24");
        bg.addColorStop(1, "#050711");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < nebulae.length; i++) {
          const nb = nebulae[i];
          const nx = wrapCoord(nb.x - viewPose.x * 0.16, 2800, 440);
          const ny = wrapCoord(nb.y - viewPose.y * 0.16, 1800, 360);
          const g = ctx.createRadialGradient(nx, ny, 10, nx, ny, nb.r);
          g.addColorStop(0, nb.c0);
          g.addColorStop(0.55, nb.c1);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(nx, ny, nb.r, 0, Math.PI * 2);
          ctx.fill();
        }

        for (let i = 0; i < farStars.length; i++) {
          const s = farStars[i];
          const sx = wrapCoord(s.x - viewPose.x * 0.22, W + 320, 160);
          const sy = wrapCoord(s.y - viewPose.y * 0.22, H + 320, 160);
          ctx.globalAlpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw));
          ctx.fillStyle = s.hue;
          ctx.beginPath();
          ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
          ctx.fill();
        }

        for (let i = 0; i < midStars.length; i++) {
          const s = midStars[i];
          const sx = wrapCoord(s.x - viewPose.x * 0.48, W + 400, 200);
          const sy = wrapCoord(s.y - viewPose.y * 0.48, H + 400, 200);
          ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw));
          ctx.fillStyle = s.hue;
          if (s.spike) {
            const arm = s.r * (3.2 + 0.9 * Math.sin(t * 2.2 + s.tw));
            ctx.beginPath();
            ctx.moveTo(sx, sy - arm);
            ctx.quadraticCurveTo(sx, sy, sx + arm, sy);
            ctx.quadraticCurveTo(sx, sy, sx, sy + arm);
            ctx.quadraticCurveTo(sx, sy, sx - arm, sy);
            ctx.quadraticCurveTo(sx, sy, sx, sy - arm);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;

        if (cfg && cfg.onDraw) cfg.onDraw(ctx, t, camPose);

        for (let i = 0; i < fgMotes.length; i++) {
          const m = fgMotes[i];
          const mx = wrapCoord(m.x - viewPose.x * 1.32 + Math.sin(t * 0.5 + m.drift) * 18, W + 500, 250);
          const my = wrapCoord(m.y - viewPose.y * 1.32 + Math.cos(t * 0.4 + m.drift) * 14, H + 500, 250);
          const g = ctx.createRadialGradient(mx, my, 0, mx, my, m.r * 3.2);
          g.addColorStop(0, `rgba(${m.hue}, ${m.alpha})`);
          g.addColorStop(1, `rgba(${m.hue}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(mx, my, m.r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      };
    }

    function _buildPaperRenderer(ctx, rng, cfg) {
      const washes = [
        { x: 420, y: 280, r: 580, c: "rgba(217, 119, 6, 0.048)" },
        { x: 1520, y: 360, r: 620, c: "rgba(22, 163, 74, 0.042)" },
        { x: 2560, y: 680, r: 640, c: "rgba(37, 99, 235, 0.036)" },
      ];
      const accents = Array.from({ length: 34 }, () => {
        const pick = rng();
        return {
          x: rng() * 3800 - 600,
          y: rng() * 2400 - 400,
          size: 7 + rng() * 16,
          kind: pick < 0.36 ? "ring" : pick < 0.72 ? "cross" : "diamond",
          color: rng() < 0.38 ? "rgba(217, 119, 6, 0.14)" : rng() < 0.72 ? "rgba(22, 163, 74, 0.13)" : "rgba(24, 24, 27, 0.085)",
          phase: rng() * Math.PI * 2,
          speed: 0.35 + rng() * 0.55,
        };
      });
      const motes = Array.from({ length: 34 }, () => ({
        x: rng() * 4800 - 800,
        y: rng() * 2800 - 500,
        r: 1.8 + rng() * 3.0,
        alpha: 0.06 + rng() * 0.08,
        rgb: rng() < 0.45 ? "180, 83, 9" : rng() < 0.8 ? "22, 101, 52" : "39, 39, 42",
        drift: rng() * Math.PI * 2,
      }));

      return function drawPaper(t) {
        ctx.clearRect(0, 0, W, H);
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, "#FBF9F5");
        bg.addColorStop(0.55, "#FAF8F4");
        bg.addColorStop(1, "#F3EFE6");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Soft editorial ambient washes (0.14x)
        for (let i = 0; i < washes.length; i++) {
          const w = washes[i];
          const wx = wrapCoord(w.x - viewPose.x * 0.14, 2800, 460);
          const wy = wrapCoord(w.y - viewPose.y * 0.14, 1800, 360);
          const g = ctx.createRadialGradient(wx, wy, 12, wx, wy, w.r);
          g.addColorStop(0, w.c);
          g.addColorStop(1, "rgba(250, 248, 244, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(wx, wy, w.r, 0, Math.PI * 2);
          ctx.fill();
        }

        // Plane 1 (0.22x): Subtle architectural dot & hairline grid
        const major = 240;
        const minor = 80;
        const ox = ((-viewPose.x * 0.22) % major + major) % major;
        const oy = ((-viewPose.y * 0.22) % major + major) % major;
        ctx.strokeStyle = "rgba(24, 24, 27, 0.048)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = ox - major; x <= W + major; x += major) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, H);
        }
        for (let y = oy - major; y <= H + major; y += major) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(W, Math.round(y) + 0.5);
        }
        ctx.stroke();

        const dx = ((-viewPose.x * 0.22) % minor + minor) % minor;
        const dy = ((-viewPose.y * 0.22) % minor + minor) % minor;
        ctx.fillStyle = "rgba(24, 24, 27, 0.085)";
        for (let x = dx - minor; x <= W + minor; x += minor) {
          for (let y = dy - minor; y <= H + minor; y += minor) {
            ctx.fillRect(x - 1, y - 1, 2, 2);
          }
        }

        // Plane 2 (0.45x): Warm amber / sage / ink floating geometric accents
        ctx.lineWidth = 1.5;
        for (let i = 0; i < accents.length; i++) {
          const a = accents[i];
          const ax = wrapCoord(a.x - viewPose.x * 0.45, W + 360, 180);
          const ay = wrapCoord(a.y - viewPose.y * 0.45 + Math.sin(t * a.speed + a.phase) * 10, H + 360, 180);
          ctx.strokeStyle = a.color;
          if (a.kind === "ring") {
            ctx.beginPath();
            ctx.arc(ax, ay, a.size, 0, Math.PI * 2);
            ctx.stroke();
          } else if (a.kind === "cross") {
            const s = a.size * 0.65;
            ctx.beginPath();
            ctx.moveTo(ax - s, ay);
            ctx.lineTo(ax + s, ay);
            ctx.moveTo(ax, ay - s);
            ctx.lineTo(ax, ay + s);
            ctx.stroke();
          } else {
            const s = a.size * 0.72;
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(t * 0.2 + a.phase);
            ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
            ctx.restore();
          }
        }

        if (cfg && cfg.onDraw) cfg.onDraw(ctx, t, camPose);

        // Plane 3 (1.25x): Delicate foreground paper motes
        for (let i = 0; i < motes.length; i++) {
          const m = motes[i];
          const mx = wrapCoord(m.x - viewPose.x * 1.25 + Math.sin(t * 0.45 + m.drift) * 14, W + 440, 220);
          const my = wrapCoord(m.y - viewPose.y * 1.25 + Math.cos(t * 0.35 + m.drift) * 11, H + 440, 220);
          const g = ctx.createRadialGradient(mx, my, 0, mx, my, m.r * 2.8);
          g.addColorStop(0, `rgba(${m.rgb}, ${m.alpha})`);
          g.addColorStop(1, `rgba(${m.rgb}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(mx, my, m.r * 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
      };
    }

    function _buildBlueprintRenderer(ctx, rng, cfg) {
      const pools = [
        { x: 460, y: 300, r: 600, c: "rgba(56, 189, 248, 0.085)" },
        { x: 1580, y: 420, r: 640, c: "rgba(99, 102, 241, 0.06)" },
        { x: 2680, y: 660, r: 620, c: "rgba(52, 211, 153, 0.05)" },
      ];
      const nodes = Array.from({ length: 40 }, () => ({
        x: Math.round((rng() * 4000 - 600) / 120) * 120,
        y: Math.round((rng() * 2400 - 400) / 120) * 120,
        arm: 8 + Math.floor(rng() * 3) * 4,
        traceX: (rng() < 0.5 ? 1 : -1) * (60 + Math.floor(rng() * 3) * 60),
        traceY: (rng() < 0.5 ? 1 : -1) * 60,
        hasTrace: rng() > 0.42,
        emerald: rng() > 0.74,
        phase: rng() * Math.PI * 2,
        speed: 0.9 + rng() * 1.3,
      }));
      const dust = Array.from({ length: 38 }, () => ({
        x: rng() * 5200 - 800,
        y: rng() * 3000 - 600,
        r: 1.8 + rng() * 3.4,
        alpha: 0.08 + rng() * 0.14,
        rgb: rng() < 0.7 ? "56, 189, 248" : "52, 211, 153",
        drift: rng() * Math.PI * 2,
      }));

      return function drawBlueprint(t) {
        ctx.clearRect(0, 0, W, H);
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, "#08101E");
        bg.addColorStop(0.55, "#0A1322");
        bg.addColorStop(1, "#070E1A");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < pools.length; i++) {
          const p = pools[i];
          const px = wrapCoord(p.x - viewPose.x * 0.15, 2900, 480);
          const py = wrapCoord(p.y - viewPose.y * 0.15, 1800, 360);
          const g = ctx.createRadialGradient(px, py, 10, px, py, p.r);
          g.addColorStop(0, p.c);
          g.addColorStop(1, "rgba(10, 19, 34, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, p.r, 0, Math.PI * 2);
          ctx.fill();
        }

        // Plane 1 (0.24x): Crisp CAD minor (60px) & major (240px) coordinate grid
        const minor = 60;
        const major = 240;
        const mx0 = ((-viewPose.x * 0.24) % minor + minor) % minor;
        const my0 = ((-viewPose.y * 0.24) % minor + minor) % minor;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.045)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = mx0 - minor; x <= W + minor; x += minor) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, H);
        }
        for (let y = my0 - minor; y <= H + minor; y += minor) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(W, Math.round(y) + 0.5);
        }
        ctx.stroke();

        const jx0 = ((-viewPose.x * 0.24) % major + major) % major;
        const jy0 = ((-viewPose.y * 0.24) % major + major) % major;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.115)";
        ctx.beginPath();
        for (let x = jx0 - major; x <= W + major; x += major) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, H);
        }
        for (let y = jy0 - major; y <= H + major; y += major) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(W, Math.round(y) + 0.5);
        }
        ctx.stroke();

        // Plane 2 (0.48x): Glowing cyan/emerald circuit traces & node crosshairs
        ctx.lineWidth = 1.4;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const nx = wrapCoord(n.x - viewPose.x * 0.48, W + 400, 200);
          const ny = wrapCoord(n.y - viewPose.y * 0.48, H + 400, 200);
          const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * n.speed + n.phase));
          const rgb = n.emerald ? "52, 211, 153" : "56, 189, 248";

          if (n.hasTrace) {
            ctx.strokeStyle = `rgba(${rgb}, ${(0.12 + 0.12 * pulse).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(nx, ny);
            ctx.lineTo(nx + n.traceX, ny);
            ctx.lineTo(nx + n.traceX, ny + n.traceY);
            ctx.stroke();
          }

          ctx.strokeStyle = `rgba(${rgb}, ${(0.20 + 0.22 * pulse).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(nx - n.arm, ny);
          ctx.lineTo(nx + n.arm, ny);
          ctx.moveTo(nx, ny - n.arm);
          ctx.lineTo(nx, ny + n.arm);
          ctx.stroke();

          ctx.fillStyle = `rgba(${rgb}, ${(0.28 + 0.30 * pulse).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(nx, ny, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }

        if (cfg && cfg.onDraw) cfg.onDraw(ctx, t, camPose);

        // Plane 3 (1.28x): Foreground data dust
        for (let i = 0; i < dust.length; i++) {
          const d = dust[i];
          const dx = wrapCoord(d.x - viewPose.x * 1.28 + Math.sin(t * 0.55 + d.drift) * 16, W + 480, 240);
          const dy = wrapCoord(d.y - viewPose.y * 1.28 + Math.cos(t * 0.42 + d.drift) * 12, H + 480, 240);
          const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, d.r * 3.0);
          g.addColorStop(0, `rgba(${d.rgb}, ${d.alpha})`);
          g.addColorStop(1, `rgba(${d.rgb}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(dx, dy, d.r * 3.0, 0, Math.PI * 2);
          ctx.fill();
        }
      };
    }

    function mountBackdrop(canvasOrSel, cfg) {
      cfg = cfg || {};
      const canvas = typeof canvasOrSel === "string" ? document.querySelector(canvasOrSel) : canvasOrSel;
      if (!canvas) return null;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      const rng = mulberry32(cfg.seed || 202611);

      let preset = String(cfg.preset || "").toLowerCase();
      if (!preset && canvas.closest) {
        const st = canvas.closest(".st-stage");
        if (st && st.classList.contains("paper")) preset = "paper";
        else if (st && st.classList.contains("blueprint")) preset = "blueprint";
      }
      if (preset === "paper") {
        onTick(_buildPaperRenderer(ctx, rng, cfg));
      } else if (preset === "blueprint") {
        onTick(_buildBlueprintRenderer(ctx, rng, cfg));
      } else {
        onTick(_buildCosmosRenderer(ctx, rng, cfg));
      }
      return ctx;
    }

    function mountCosmos(canvasOrSel, cfg) {
      return mountBackdrop(canvasOrSel, Object.assign({}, cfg || {}, { preset: "cosmos" }));
    }

    function onTick(fn) {
      tickCallbacks.push(fn);
      return stage;
    }

    function dispatchTick(t) {
      // Deterministic continuous handheld/cinematic camera drift + shake envelope
      let driftX = 0, driftY = 0, driftScale = 1, driftRot = 0;
      if (driftCfg.enabled) {
        const sp = driftCfg.speed;
        driftX = (Math.sin(t * 0.67 * sp) * 0.65 + Math.sin(t * 1.31 * sp + 1.4) * 0.35) * driftCfg.swayX;
        driftY = (Math.cos(t * 0.53 * sp + 0.8) * 0.65 + Math.sin(t * 1.07 * sp + 2.3) * 0.35) * driftCfg.swayY;
        driftScale = 1 + (Math.sin(t * 0.49 * sp + 0.3) * 0.65 + Math.cos(t * 0.93 * sp + 1.7) * 0.35) * driftCfg.scale;
        driftRot = (Math.sin(t * 0.41 * sp + 0.5) * 0.65 + Math.sin(t * 0.87 * sp + 2.1) * 0.35) * driftCfg.rot;
      }

      viewPose.x = camPose.x - driftX;
      viewPose.y = camPose.y - driftY;
      viewPose.scale = camPose.scale * driftScale;
      viewPose.rot = camPose.rot + driftRot;

      // Update any DOM [data-parallax] planes
      const planes = document.querySelectorAll("[data-parallax]");
      for (let i = 0; i < planes.length; i++) {
        const el = planes[i];
        const k = parseFloat(el.getAttribute("data-parallax") || "0.3");
        const px = -viewPose.x * k;
        const py = -viewPose.y * k;
        const ps = 1 + (viewPose.scale - 1) * k;
        el.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${ps.toFixed(4)})`;
      }

      let sx = 0, sy = 0;
      for (let i = 0; i < shakeEvents.length; i++) {
        const ev = shakeEvents[i];
        if (t >= ev.t0 && t <= ev.t1) {
          const k = 1 - (t - ev.t0) / Math.max(0.001, ev.t1 - ev.t0);
          sx += Math.sin(t * 97.3 + i) * ev.amp * k * k;
          sy += Math.cos(t * 113.7 + i * 2) * ev.amp * 0.8 * k * k;
        }
      }

      const tx = sx + driftX;
      const ty = sy + driftY;
      const shakeEl = document.querySelector(shakeSel);
      if (shakeEl) {
        const hasMotion = tx || ty || driftScale !== 1 || driftRot !== 0;
        shakeEl.style.transform = hasMotion
          ? `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${driftScale.toFixed(5)}) rotate(${driftRot.toFixed(3)}deg)`
          : "translate3d(0,0,0)";
      } else {
        const pivotEl = document.querySelector(pivotSel);
        if (pivotEl && (tx || ty || driftScale !== 1 || driftRot !== 0)) {
          global.gsap.set(pivotEl, {
            x: tx,
            y: ty,
            scale: camPose.scale * driftScale,
            rotation: camPose.rot + driftRot,
          });
        }
      }

      for (let i = 0; i < tickCallbacks.length; i++) {
        tickCallbacks[i](t, camPose);
      }
    }

    function seek(t) {
      tl.seek(t, false);
      dispatchTick(t);
      return stage;
    }

    function finalize() {
      tl.to({}, { duration: duration }, 0);
      tl.eventCallback("onUpdate", function () {
        dispatchTick(tl.time());
      });
      global.addEventListener("hf-seek", function (ev) {
        const seekTime = ev && ev.detail && typeof ev.detail.time === "number" ? ev.detail.time : tl.time();
        dispatchTick(seekTime);
      });
      global.__timelines[compId] = tl;
      dispatchTick(0);
      return tl;
    }

    const stage = {
      tl,
      W,
      H,
      duration,
      data,
      camPose,
      viewPose,
      clamp,
      lerp,
      smooth,
      env,
      mulberry32,
      setDrift,
      scene,
      cue,
      camInit,
      camTo,
      whipTo,
      zoomThrough,
      shake,
      popIn,
      fadeOut,
      implode,
      drawStroke,
      highlightSweep,
      stampSlam,
      kineticPunch,
      kenBurns,
      counter,
      scallopPath,
      coronaFlares,
      mountBackdrop,
      mountCosmos,
      onTick,
      seek,
      finalize,
    };

    // Applied after `stage` exists, since setDrift returns it.
    if (opts.drift && typeof opts.drift === "object") setDrift(opts.drift);
    return stage;
  }

  global.ExplainerStage = {
    create: createStage,
    clamp,
    lerp,
    smooth,
    env,
    mulberry32,
  };
})(window);

/* Reusable Single-Take Three.js Cinema Rig for /video-explainer (Mode: 3d)
 * Requires window.THREE (three@0.149.0, auto-injected by build.py when Mode: 3d or Studio3D is used).
 * Provides:
 *   - Deterministic hf-seek rendering via ExplainerStage (preserveDrawingBuffer: true, zero async loaders)
 *   - Procedural studio softbox PMREM HDRI reflections + safe anti-whiteout ACES Filmic bloom composer
 *   - Synchronous base64 IEEE-754 Float32 / Uint16 / Uint32 BufferGeometry loader (window.STUDIO_ASSETS)
 *   - PBR material presets + HiDPI matte CanvasTexture plaques with <= 8 deg lens-facing & caption-safe clamping
 *   - Smooth C2 camera keyframe spline + multi-act handoff registry
 */
(function (global) {
  "use strict";
  if (global.Studio3D) return;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function smoothstep(a, b, x) {
    if (a === b) return x < a ? 0 : 1;
    const u = clamp((x - a) / (b - a), 0, 1);
    return u * u * (3 - 2 * u);
  }
  function smootherstep(a, b, x) {
    if (a === b) return x < a ? 0 : 1;
    const u = clamp((x - a) / (b - a), 0, 1);
    return u * u * u * (u * (u * 6 - 15) + 10);
  }
  function env(t, t0, t1, fi, fo) {
    if (t <= t0 || t >= t1) return 0;
    const up = fi > 0 ? smoothstep(t0, t0 + fi, t) : 1;
    const dn = fo > 0 ? 1 - smoothstep(t1 - fo, t1, t) : 1;
    return up * dn;
  }
  function seededRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shakeVec(t, tTrigger, amp, dur) {
    const dt = t - tTrigger;
    if (dt < 0 || dt > dur) return { x: 0, y: 0, z: 0, roll: 0 };
    const a = amp * Math.pow(1 - dt / dur, 2.2);
    return {
      x: (Math.sin(dt * 59.3) * 0.65 + Math.cos(dt * 97.1) * 0.35) * a,
      y: (Math.cos(dt * 67.7) * 0.65 + Math.sin(dt * 113.5) * 0.35) * a * 0.85,
      z: Math.sin(dt * 43.9) * a * 0.4,
      roll: Math.sin(dt * 51.2) * a * 0.08,
    };
  }

  function decodeBytes(b64) {
    const bin = typeof global.atob === "function" ? global.atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function toF32(arr) {
    if (!arr) return null;
    if (arr instanceof Float32Array) return arr;
    return typeof arr === "string" ? new Float32Array(decodeBytes(arr)) : new Float32Array(arr);
  }

  function buildGeo(spec) {
    const THREE = global.THREE;
    if (!THREE) throw new Error("Studio3D requires window.THREE loaded first");
    if (!spec) throw new Error("Studio3D.buildGeo: missing mesh spec");
    if (spec.isBufferGeometry) return spec;
    const geo = new THREE.BufferGeometry();
    const pos = toF32(spec.positions || spec.pos || spec.v);
    if (!pos) throw new Error("Studio3D.buildGeo: missing positions");
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const vCount = pos.length / 3;
    const nrm = toF32(spec.normals || spec.nrm || spec.n);
    if (nrm && nrm.length === pos.length) geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    const uvs = toF32(spec.uvs || spec.uv);
    if (uvs && uvs.length === vCount * 2) geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    const idxRaw = spec.indices || spec.idx || spec.f;
    if (idxRaw) {
      let idx;
      if (idxRaw instanceof Uint32Array || idxRaw instanceof Uint16Array) idx = idxRaw;
      else if (typeof idxRaw === "string") {
        idx = (spec.indexType === "u32" || (spec.indexType !== "u16" && vCount > 65535))
          ? new Uint32Array(decodeBytes(idxRaw))
          : new Uint16Array(decodeBytes(idxRaw));
      } else {
        idx = vCount > 65535 ? new Uint32Array(idxRaw) : new Uint16Array(idxRaw);
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  function loadAsset(name, bag) {
    const store = bag || global.STUDIO_ASSETS || {};
    if (!store[name]) throw new Error("Studio3D.loadAsset: missing asset '" + name + "'");
    return buildGeo(store[name]);
  }

  function cameraSpline(keyframes) {
    const kfs = (keyframes || []).slice().sort(function (a, b) { return a.t - b.t; });
    return function samplePose(t) {
      if (!kfs.length) return { pos: [0, 1.2, 7.5], target: [0, 0, 0], fov: 42, roll: 0 };
      if (t <= kfs[0].t) return kfs[0];
      if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1];
      let i = 0;
      while (i < kfs.length - 2 && t >= kfs[i + 1].t) i++;
      const a = kfs[i], b = kfs[i + 1];
      const u = smootherstep(a.t, b.t, t);
      return {
        pos: [lerp(a.pos[0], b.pos[0], u), lerp(a.pos[1], b.pos[1], u), lerp(a.pos[2], b.pos[2], u)],
        target: [lerp(a.target[0], b.target[0], u), lerp(a.target[1], b.target[1], u), lerp(a.target[2], b.target[2], u)],
        fov: lerp(a.fov || 42, b.fov || 42, u),
        roll: lerp(a.roll || 0, b.roll || 0, u),
      };
    };
  }

  function blendPoses(pA, pB, k) {
    const u = smootherstep(0, 1, k);
    return {
      pos: [lerp(pA.pos[0], pB.pos[0], u), lerp(pA.pos[1], pB.pos[1], u), lerp(pA.pos[2], pB.pos[2], u)],
      target: [lerp(pA.target[0], pB.target[0], u), lerp(pA.target[1], pB.target[1], u), lerp(pA.target[2], pB.target[2], u)],
      fov: lerp(pA.fov || 42, pB.fov || 42, u),
      roll: lerp(pA.roll || 0, pB.roll || 0, u),
    };
  }

  function buildStudioEnvMap(THREE, renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x060d1d);
    function softbox(hex, intensity, w, h, pos, look) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(look[0], look[1], look[2]);
      envScene.add(m);
    }
    softbox(0xdbeafe, 2.8, 26, 18, [0, 18, 2], [0, 0, 0]);
    softbox(0x38bdf8, 2.4, 8, 24, [-16, 5, 10], [0, 0, 0]);
    softbox(0xfde68a, 2.0, 8, 24, [16, 6, 8], [0, 0, 0]);
    softbox(0x60a5fa, 2.2, 22, 10, [0, 8, -18], [0, 0, 0]);
    const rt = pmrem.fromScene(envScene, 0.035);
    pmrem.dispose();
    return rt.texture;
  }

  function createMaterials(THREE, envMap) {
    return {
      titaniumBrushed: function (o) { return new THREE.MeshStandardMaterial(Object.assign({ color: 0x9aa5b4, metalness: 0.9, roughness: 0.26, envMap: envMap, envMapIntensity: 1.4 }, o)); },
      titaniumDark: function (o) { return new THREE.MeshStandardMaterial(Object.assign({ color: 0x263040, metalness: 0.86, roughness: 0.32, envMap: envMap, envMapIntensity: 1.25 }, o)); },
      chromeMirror: function (o) { return new THREE.MeshStandardMaterial(Object.assign({ color: 0xeaf2fb, metalness: 0.96, roughness: 0.12, envMap: envMap, envMapIntensity: 1.65 }, o)); },
      mattePlaque: function (o) { return new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, metalness: 0.04, roughness: 0.92, envMapIntensity: 0.25 }, o)); },
      sapphireGlass: function (o) { return new THREE.MeshPhysicalMaterial(Object.assign({ color: 0x60a5fa, emissive: 0x0b2948, emissiveIntensity: 0.45, metalness: 0.1, roughness: 0.09, transparent: true, opacity: 0.72, clearcoat: 1.0, envMap: envMap, envMapIntensity: 1.5 }, o)); },
      vaultGold: function (o) { return new THREE.MeshStandardMaterial(Object.assign({ color: 0xfbbf24, emissive: 0x451a03, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.22, envMap: envMap, envMapIntensity: 1.5 }, o)); },
      emeraldCore: function (o) { return new THREE.MeshStandardMaterial(Object.assign({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.24, envMap: envMap, envMapIntensity: 1.2 }, o)); },
      emissiveGlow: function (hex, intensity, o) { return new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(hex).multiplyScalar(intensity === undefined ? 1.5 : intensity), toneMapped: false }, o)); },
    };
  }

  function createBloomComposer(THREE, renderer, W, H, opts) {
    opts = opts || {};
    const isWebGL2 = renderer.capabilities.isWebGL2;
    const canFloat = (isWebGL2 && renderer.extensions.has("EXT_color_buffer_float")) || renderer.extensions.has("EXT_color_buffer_half_float");
    const rtType = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    function makeRT(w, h, depth, samples) {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: Boolean(depth), stencilBuffer: false });
      if (isWebGL2 && samples > 0 && canFloat) rt.samples = samples;
      return rt;
    }
    const rtScene = makeRT(W, H, true, 4);
    const w1 = Math.max(1, Math.floor(W / 2)), h1 = Math.max(1, Math.floor(H / 2));
    const rtBright = makeRT(w1, h1, false, 0), rtBlurH = makeRT(w1, h1, false, 0), rtBlurV = makeRT(w1, h1, false, 0);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadVert = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }";

    const matBright = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: "uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv; void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; float br=max(c.r,max(c.g,c.b)); float w=max(0.0,br-uThreshold)/max(br,1e-4); gl_FragColor=vec4(c*w,1.0); }",
      uniforms: { tDiffuse: { value: rtScene.texture }, uThreshold: { value: opts.threshold === undefined ? 1.05 : opts.threshold } },
      depthTest: false, depthWrite: false,
    });
    const matBlur = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: "uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv; void main(){ vec3 s=texture2D(tDiffuse,vUv).rgb*0.227027; s+=texture2D(tDiffuse,vUv+uStep*1.384615).rgb*0.316216; s+=texture2D(tDiffuse,vUv-uStep*1.384615).rgb*0.316216; s+=texture2D(tDiffuse,vUv+uStep*3.230769).rgb*0.070270; s+=texture2D(tDiffuse,vUv-uStep*3.230769).rgb*0.070270; gl_FragColor=vec4(s,1.0); }",
      uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2(1 / w1, 0) } },
      depthTest: false, depthWrite: false,
    });
    const matComp = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: [
        "uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uStrength; uniform float uExposure; uniform float uVignette; varying vec2 vUv;",
        "vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }",
        "vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055, step(vec3(0.0031308),c)); }",
        "void main(){ vec3 hdr=texture2D(tScene,vUv).rgb + uStrength*texture2D(tBloom,vUv).rgb;",
        "vec2 d=vUv-0.5; hdr*=clamp(1.0-uVignette*dot(d,d)*1.7, 0.64, 1.0);",
        "gl_FragColor=vec4(toSRGB(aces(hdr*uExposure)),1.0); }"
      ].join("\n"),
      uniforms: {
        tScene: { value: rtScene.texture },
        tBloom: { value: rtBlurV.texture },
        uStrength: { value: opts.bloomStrength === undefined ? 0.42 : opts.bloomStrength },
        uExposure: { value: opts.exposure === undefined ? 1.0 : opts.exposure },
        uVignette: { value: opts.vignette === undefined ? 0.22 : opts.vignette },
      },
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matBright);
    const postScene = new THREE.Scene();
    postScene.add(quad);

    return {
      params: {
        threshold: matBright.uniforms.uThreshold.value,
        bloomStrength: matComp.uniforms.uStrength.value,
        exposure: matComp.uniforms.uExposure.value,
        vignette: matComp.uniforms.uVignette.value,
      },
      render: function (scene, camera) {
        renderer.setRenderTarget(rtScene);
        renderer.clear();
        renderer.render(scene, camera);
        matBright.uniforms.uThreshold.value = this.params.threshold;
        quad.material = matBright;
        renderer.setRenderTarget(rtBright);
        renderer.render(postScene, ortho);
        quad.material = matBlur;
        matBlur.uniforms.tDiffuse.value = rtBright.texture;
        matBlur.uniforms.uStep.value.set(1 / w1, 0);
        renderer.setRenderTarget(rtBlurH);
        renderer.render(postScene, ortho);
        matBlur.uniforms.tDiffuse.value = rtBlurH.texture;
        matBlur.uniforms.uStep.value.set(0, 1 / h1);
        renderer.setRenderTarget(rtBlurV);
        renderer.render(postScene, ortho);
        matComp.uniforms.uStrength.value = this.params.bloomStrength;
        matComp.uniforms.uExposure.value = this.params.exposure;
        matComp.uniforms.uVignette.value = this.params.vignette;
        quad.material = matComp;
        renderer.setRenderTarget(null);
        renderer.render(postScene, ortho);
      },
    };
  }

  const registeredActs = [];
  function registerAct(name, span, factoryFn) {
    if (typeof span === "function") {
      factoryFn = span;
      span = null;
    }
    registeredActs.push({ name: name, span: span, factory: factoryFn });
  }

  function createStudio(compId, canvasOrSel, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error("Studio3D requires window.THREE (three@0.149.0) loaded first");
    if (typeof compId === "object" && compId !== null) {
      opts = canvasOrSel || {};
      canvasOrSel = compId;
      compId = opts.compId || "world-comp";
    }
    opts = opts || {};
    const data = global.__EXPLAINER_DATA__ || { width: 1920, height: 1080, fps: 30, duration: 60, scenes: [], words: [] };
    const W = Number(opts.width || data.width || 1920);
    const H = Number(opts.height || data.height || 1080);
    const duration = Number(opts.duration || data.duration || 60);

    const canvas = typeof canvasOrSel === "string" ? document.querySelector(canvasOrSel) : canvasOrSel;
    // The WebGL canvas is the whole film, so tell the layout audit a full-frame cover is intended.
    if (canvas && canvas.setAttribute) canvas.setAttribute("data-layout-allow-occlusion", "");
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.toneMapping = THREE.NoToneMapping;

    const bgHex = opts.background === undefined ? 0x060d1d : opts.background;
    const bgLinear = new THREE.Color(bgHex).convertSRGBToLinear();
    renderer.setClearColor(bgLinear, 1.0);

    const scene = new THREE.Scene();
    scene.background = bgLinear;
    if (opts.fog !== false) scene.fog = new THREE.FogExp2(bgLinear, opts.fogDensity || 0.011);

    const envMap = buildStudioEnvMap(THREE, renderer);
    scene.environment = envMap;

    const camera = new THREE.PerspectiveCamera(opts.fov || 42, W / H, 0.15, 280);
    camera.position.set(0, 1.2, 7.4);

    scene.add(new THREE.HemisphereLight(0xbae6fd, 0x091326, 0.72));
    const keyLight = new THREE.DirectionalLight(0xf0f9ff, 1.35);
    keyLight.position.set(-6.5, 11.0, 9.5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.95);
    rimLight.position.set(8.0, 6.0, -7.5);
    scene.add(rimLight);
    const camFill = new THREE.PointLight(0xe0f2fe, 0.48, 42, 1.5);
    camera.add(camFill);
    scene.add(camera);

    const bloom = createBloomComposer(THREE, renderer, W, H, opts.bloom);
    const materials = createMaterials(THREE, envMap);
    const expStage = global.ExplainerStage.create(compId || "world-comp", { width: W, height: H, duration: duration, drift: false });
    expStage.setDrift(false);

    function createCanvasTexture(tw, th, drawFn) {
      const c = document.createElement("canvas");
      c.width = tw;
      c.height = th;
      const g = c.getContext("2d");
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 8;
      if (typeof drawFn === "function") {
        drawFn(g, tw, th);
        tex.needsUpdate = true;
      }
      return {
        canvas: c,
        ctx: g,
        texture: tex,
        update: function (fn) { fn(g, tw, th); tex.needsUpdate = true; },
      };
    }

    // Matte anti-whiteout 3D HUD/callout plaque facing camera cleanly
    function makePlaque(label, popts) {
      const o = popts || {};
      const tw = o.texWidth || 768, th = o.texHeight || 192;
      const worldW = o.width || 2.8, worldH = o.height || (worldW * (th / tw));
      const bg = o.bg || "#0B1326", fg = o.fg || "#F8FAFC", border = o.border || "#38BDF8";
      const ct = createCanvasTexture(tw, th, function (g, cw, ch) {
        g.clearRect(0, 0, cw, ch);
        g.fillStyle = bg;
        g.strokeStyle = border;
        g.lineWidth = 8;
        g.beginPath();
        g.roundRect(10, 10, cw - 20, ch - 20, 34);
        g.fill();
        g.stroke();
        g.fillStyle = fg;
        g.font = "800 " + (o.fontSize || 62) + 'px "Ftitle", -apple-system, sans-serif';
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(label || ""), cw * 0.5, ch * 0.52);
      });
      const mat = new THREE.MeshBasicMaterial({ map: ct.texture, transparent: true, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
      mesh.userData.canvasTex = ct;
      return mesh;
    }

    const _tmpPos = new THREE.Vector3();
    const _camQuat = new THREE.Quaternion();
    function faceCamera(mesh, maxTiltRad) {
      if (!mesh) return;
      camera.getWorldQuaternion(_camQuat);
      mesh.quaternion.slerp(_camQuat, maxTiltRad === undefined ? 0.92 : clamp(1 - maxTiltRad, 0.75, 1));
    }

    function clampAboveCaptions(mesh, maxScreenYRatio) {
      if (!mesh) return;
      const limitNdcY = 1 - 2 * (maxScreenYRatio || (H > W ? 0.70 : 0.76));
      mesh.getWorldPosition(_tmpPos);
      _tmpPos.project(camera);
      if (_tmpPos.y < limitNdcY) {
        _tmpPos.y = limitNdcY;
        _tmpPos.unproject(camera);
        if (mesh.parent) mesh.parent.worldToLocal(_tmpPos);
        mesh.position.copy(_tmpPos);
      }
    }

    let customCameraFn = null;
    const tickFns = [];
    const builtActs = [];

    function initActsIfNeeded() {
      if (builtActs.length || !registeredActs.length) return;
      for (let i = 0; i < registeredActs.length; i++) {
        const entry = registeredActs[i];
        const inst = entry.factory(api);
        if (inst && inst.group) scene.add(inst.group);
        builtActs.push({ name: entry.name, span: entry.span || inst.span || [0, duration], inst: inst });
      }
    }

    function applyPose(pose, t) {
      if (!pose) return;
      const drift = opts.drift === false ? 0 : 1;
      const dx = Math.sin(t * 0.65) * 0.06 * drift;
      const dy = Math.cos(t * 0.52) * 0.045 * drift;
      camera.position.set(pose.pos[0] + dx, pose.pos[1] + dy, pose.pos[2]);
      camera.fov = pose.fov || 42;
      camera.up.set(Math.sin(pose.roll || 0), Math.cos(pose.roll || 0), 0);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }

    const api = {
      THREE: THREE,
      W: W,
      H: H,
      duration: duration,
      renderer: renderer,
      scene: scene,
      camera: camera,
      bloom: bloom,
      materials: materials,
      stage: expStage,
      sceneInfo: expStage.scene,
      cue: expStage.cue,
      clamp: clamp,
      lerp: lerp,
      smoothstep: smoothstep,
      smootherstep: smootherstep,
      env: env,
      seededRng: seededRng,
      shakeVec: shakeVec,
      buildGeo: buildGeo,
      loadAsset: loadAsset,
      cameraSpline: cameraSpline,
      createCanvasTexture: createCanvasTexture,
      makePlaque: makePlaque,
      faceCamera: faceCamera,
      clampAboveCaptions: clampAboveCaptions,
      setCameraPath: function (keyframesOrFn) {
        customCameraFn = typeof keyframesOrFn === "function" ? keyframesOrFn : cameraSpline(keyframesOrFn);
        return api;
      },
      onTick: function (fn) { if (typeof fn === "function") tickFns.push(fn); return api; },
      finalize: function () { expStage.finalize(); return api; },
    };

    expStage.onTick(function (t) {
      initActsIfNeeded();
      const tc = clamp(Number(t || 0), 0, duration);
      let pose = customCameraFn ? customCameraFn(tc) : null;

      if (builtActs.length) {
        const win = opts.handoffWindow === undefined ? 1.1 : opts.handoffWindow;
        for (let i = 0; i < builtActs.length; i++) {
          const a = builtActs[i];
          const t0 = a.span[0], t1 = a.span[1];
          const vis = tc >= t0 - win && tc <= t1 + win;
          if (a.inst.group) a.inst.group.visible = vis;
          if (vis && typeof a.inst.update === "function") a.inst.update(tc);
        }
        if (!pose) {
          let activeIdx = 0;
          for (let i = 0; i < builtActs.length; i++) {
            if (tc >= builtActs[i].span[0]) activeIdx = i;
          }
          const cur = builtActs[activeIdx];
          pose = cur.inst.getCameraPose ? cur.inst.getCameraPose(tc) : null;
          if (activeIdx > 0 && win > 0) {
            const prev = builtActs[activeIdx - 1];
            const boundary = cur.span[0];
            if (Math.abs(tc - boundary) < win * 0.5 && prev.inst.getCameraPose && pose) {
              const k = (tc - (boundary - win * 0.5)) / win;
              pose = blendPoses(prev.inst.getCameraPose(tc), pose, k);
            }
          }
        }
      }

      if (pose) applyPose(pose, tc);
      for (let i = 0; i < tickFns.length; i++) tickFns[i](tc, api);
      bloom.render(scene, camera);
    });

    return api;
  }

  global.Studio3D = {
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    smootherstep: smootherstep,
    env: env,
    seededRng: seededRng,
    shakeVec: shakeVec,
    buildGeo: buildGeo,
    loadAsset: loadAsset,
    cameraSpline: cameraSpline,
    registerAct: registerAct,
    create: createStudio,
  };
})(typeof window !== "undefined" ? window : globalThis);

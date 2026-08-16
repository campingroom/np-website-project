/* hl-gallery.js — WebGL layer for the ไฮไลต์ grid.
   The DOM grid stays the single source of truth for layout and scrolling;
   this engine reads each card's getBoundingClientRect() every frame and drives
   one textured plane per card in a single fullscreen canvas, damped so the
   planes trail the real scroll a little.
   Usage: window.HLGallery.mount({ root, reduced }) -> { destroy() }
   Requires window.THREE (r150+). */
(function () {

  /* ── tunables ─────────────────────────────────────────────────────────── */
  var CFG = {
    DAMP_RECT:    12.5,  // position/size follow (higher = tighter to the DOM)
    DAMP_VEL:     12.5,  // scroll-velocity decay back to flat (higher = snaps flat sooner)
    DAMP_HOVER:    7.0,  // hover ramp in/out
    DAMP_ZOOM:     4.0,  // scroll-zoom ease
    DAMP_POINTER:  4.2,  // pointer follow (low = more lag)

    POINTER_UV:  0.045,  // how far the image drags toward the pointer (crop fraction)
    POINTER_PX:   11.0,  // how far the plane itself nudges toward the pointer (px)
    ZOOM_BASE:    0.06,  // always-on crop headroom so the drag never runs off-texture

    VEL_PER_PX:   1 / 46, // px of scroll per frame that maps to velocity 1.0
    VEL_CLAMP:    0.92,

    CURVE_AMP:      34,  // px of Y displacement at velocity 1.0 (the arc/wheel bend)
    CURVE_NARROW: 0.55,  // narrow screens bend far less — a big arc there just smears
    ZOOM_MAX:     0.08,  // texture scale at the centre of the viewport (1.0 -> 1.08)

    NOISE_FREQ:    5.4,  // hover tremble: noise cells across the card
    NOISE_AMP:   0.007,  // hover tremble: UV displacement (fraction of the card)
    NOISE_SPEED:   3.0,  // hover tremble: how fast the noise field moves
    HOVER_VERT:    2.6,  // hover tremble: extra px of vertex wobble
    HOVER_TAU:    0.85,  // ripple half-life in s — it settles ~2.5s after entry

    TEXT_ROT:      2.1,  // deg of title rotation at velocity 1.0
    TEXT_SKEW:     1.3,  // deg of title skewY at velocity 1.0

    RADIUS:         15,  // must match the DOM media border-radius
    SEG:      [44, 30],  // plane subdivisions (x, y) — enough for a smooth bend
    EXPOSURE:      1.0,  // 1.0 = true colour; raise a touch (1.05) to lift the photos
    MAX_DPR:         2,
    MARGIN:        260   // px outside the viewport still rendered
  };

  /* exponential (critically-damped style) interpolation — frame-rate safe */
  function damp(cur, tgt, lambda, dt) {
    return tgt + (cur - tgt) * Math.exp(-lambda * dt);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* 2D simplex noise (Ashima / Gustavson), shared by both shader stages */
  var SNOISE = [
    'vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }',
    'float snoise(vec2 v){',
    '  const vec4 C = vec4(0.211324865, 0.366025404, -0.577350269, 0.024390244);',
    '  vec2 i = floor(v + dot(v, C.yy));',
    '  vec2 x0 = v - i + dot(i, C.xx);',
    '  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;',
    '  i = mod(i, 289.0);',
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));',
    '  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);',
    '  m = m*m; m = m*m;',
    '  vec3 x = 2.0 * fract(p * C.www) - 1.0;',
    '  vec3 h = abs(x) - 0.5;',
    '  vec3 ox = floor(x + 0.5);',
    '  vec3 a0 = x - ox;',
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);',
    '  vec3 g;',
    '  g.x = a0.x * x0.x + h.x * x0.y;',
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '  return 130.0 * dot(m, g);',
    '}'
  ].join('\n');

  /* ── vertex shader ─────────────────────────────────────────────────────
     The plane is a unit quad scaled to the card's pixel size, so any px
     value used here is divided by uSize to get back into local units.
     · uVel bends the quad along its local Y with a half-sine across X —
       the card reads as a strip wrapped on a big wheel while you scroll.
     · uHover adds a small time-varying noise wobble to the geometry. */
  var VERT = [
    'uniform float uVel;',
    'uniform float uCurve;',
    'uniform float uHover;',
    'uniform float uHoverVert;',
    'uniform float uTime;',
    'uniform vec2  uSize;',
    'varying vec2  vUv;',
    SNOISE,
    'void main(){',
    '  vUv = uv;',
    '  vec3 p = position;',
    '  float arc = sin(uv.x * 3.14159265);',            // 0 at the edges, 1 mid-card
    '  p.y += (arc * uVel * uCurve) / max(uSize.y, 1.0);',
    '  float n = snoise(vec2(uv.x * 3.0 + uTime * 0.9, uv.y * 3.0 - uTime * 0.7));',
    '  float edge = sin(uv.x * 3.14159265) * sin(uv.y * 3.14159265);',
    '  p.xy += (n * uHover * uHoverVert * edge) / max(uSize, vec2(1.0));',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  /* ── fragment shader ───────────────────────────────────────────────────
     · uRatio does the cover-fit (same as CSS background-size: cover).
     · uZoom scales the texture about its centre — driven by how close the
       card is to the middle of the viewport.
     · uHover drives two noise lookups that jitter the sample point, so the
       hovered image trembles and settles crisp again on leave.
     · the last block rebuilds the DOM box's 15px rounded corners as an SDF
       mask, since the real <div> is hidden while WebGL is on. */
  var FRAG = [
    'uniform sampler2D uTex;',
    'uniform vec2  uSize;',
    'uniform vec2  uRatio;',
    'uniform float uZoom;',
    'uniform float uHover;',
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform float uRadius;',
    'uniform float uNoiseFreq;',
    'uniform float uNoiseAmp;',
    'uniform float uNoiseSpeed;',
    'uniform float uExposure;',
    'uniform vec2  uPointer;',
    'uniform float uPointerAmt;',
    'varying vec2  vUv;',
    SNOISE,
    'void main(){',
    '  vec2 c = (vUv - 0.5) / uZoom * uRatio + 0.5;',
    '  c += vec2(-uPointer.x, uPointer.y) * uPointerAmt;',   // image drags after the cursor
    '  float nx = snoise(c * uNoiseFreq + vec2(uTime * uNoiseSpeed, 0.0));',
    '  float ny = snoise(c * uNoiseFreq + vec2(0.0, uTime * uNoiseSpeed + 11.3));',
    '  float wave = sin((c.y + c.x * 0.35) * 24.0 - uTime * 5.5);',
    '  c += vec2(nx + wave * 0.45, ny) * uHover * uNoiseAmp;',
    '  vec4 tex = texture2D(uTex, clamp(c, 0.0015, 0.9985));',
    '  vec2 p = (vUv - 0.5) * uSize;',
    '  vec2 q = abs(p) - (uSize * 0.5 - uRadius);',
    '  float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - uRadius;',
    '  float mask = 1.0 - smoothstep(-1.0, 1.0, d);',
    '  gl_FragColor = vec4(tex.rgb * uExposure, tex.a * mask * uOpacity);',
    '}'
  ].join('\n');

  function mount(opts) {
    var THREE = window.THREE;
    var root = opts && opts.root;
    if (!THREE || !root) return { destroy: function () {} };

    /* only cards that carry a still image — a card with a hover <video>
       keeps its DOM treatment */
    var cards = [].slice.call(root.querySelectorAll('[data-hl-card][data-hl-src]'))
      .filter(function (c) {
        return !!c.getAttribute('data-hl-src') && !c.querySelector('[data-hl-video]');
      });
    if (!cards.length) return { destroy: function () {} };

    var canvas, renderer;
    try {
      canvas = document.createElement('canvas');
      canvas.setAttribute('data-hl-canvas', '');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:fixed; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:20;';
      document.body.appendChild(canvas);
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    } catch (err) {
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return { destroy: function () {} };
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.MAX_DPR));

    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
    var geo = new THREE.PlaneGeometry(1, 1, CFG.SEG[0], CFG.SEG[1]);
    var loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    var items = cards.map(function (card) {
      var mat = new THREE.ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false,
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uTex:        { value: null },
          uSize:       { value: new THREE.Vector2(1, 1) },
          uRatio:      { value: new THREE.Vector2(1, 1) },
          uZoom:       { value: 1 },
          uVel:        { value: 0 },
          uCurve:      { value: CFG.CURVE_AMP * (window.innerWidth < 760 ? CFG.CURVE_NARROW : 1) },
          uHover:      { value: 0 },
          uHoverVert:  { value: CFG.HOVER_VERT },
          uTime:       { value: 0 },
          uOpacity:    { value: 1 },
          uRadius:     { value: CFG.RADIUS },
          uNoiseFreq:  { value: CFG.NOISE_FREQ },
          uNoiseAmp:   { value: CFG.NOISE_AMP },
          uNoiseSpeed: { value: CFG.NOISE_SPEED },
          uExposure:   { value: CFG.EXPOSURE },
          uPointer:    { value: new THREE.Vector2(0, 0) },
          uPointerAmt: { value: CFG.POINTER_UV }
        }
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);

      var it = {
        card: card,
        media: card.querySelector('[data-hl-media]') || card,
        base: card.querySelector('[data-hl-base]'),
        title: card.querySelector('[data-hl-title]'),
        mesh: mesh, mat: mat,
        x: null, y: null, w: 1, h: 1,
        zoom: 1, hover: 0, hovered: false, hoverAt: 0,
        px: 0, py: 0, ptx: 0, pty: 0,
        texW: 1, texH: 1, ready: false
      };

      loader.load(card.getAttribute('data-hl-src'), function (tex) {
        /* the shader samples the stored sRGB bytes verbatim, so switch OFF
           three's hardware decode (textures arrive sRGB-tagged by default —
           left on, WebGL2 uploads SRGB8_ALPHA8 and the photos render dark) */
        if ('encoding' in tex) tex.encoding = THREE.LinearEncoding;
        if ('colorSpace' in tex) tex.colorSpace = THREE.NoColorSpace || '';
        tex.needsUpdate = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        mat.uniforms.uTex.value = tex;
        it.texW = tex.image.width || 1;
        it.texH = tex.image.height || 1;
        it.ready = true;
        /* hand the card over from DOM to WebGL only once its texture is up */
        if (it.base) {
          it.base.style.transition = 'opacity .35s ease';
          it.base.style.opacity = '0';
        }
        var motion = card.querySelector('[data-hl-motion]');
        if (motion) motion.style.display = 'none';
      }, undefined, function () { /* texture failed: the DOM image stays */ });

      return it;
    });

    /* hover targets come from the real DOM cards (the canvas ignores input) */
    function now() { return performance.now() / 1000; }
    function onOver(e) {
      var card = e.target && e.target.closest ? e.target.closest('[data-hl-card]') : null;
      items.forEach(function (it) {
        var on = it.card === card;
        if (on && !it.hovered) it.hoverAt = now();   // (re)start the ripple envelope
        it.hovered = on;
      });
    }
    function onLeave() { items.forEach(function (it) { it.hovered = false; it.ptx = 0; it.pty = 0; }); }
    function onMove(e) {
      var card = e.target && e.target.closest ? e.target.closest('[data-hl-card]') : null;
      items.forEach(function (it) {
        if (it.card !== card) { it.ptx = 0; it.pty = 0; return; }
        var r = it.media.getBoundingClientRect();
        if (!r.width || !r.height) return;
        it.ptx = clamp((e.clientX - r.left) / r.width - 0.5, -0.5, 0.5);
        it.pty = clamp((e.clientY - r.top) / r.height - 0.5, -0.5, 0.5);
      });
    }
    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointermove', onMove);

    var vw = 0, vh = 0;
    function resize() {
      vw = window.innerWidth; vh = window.innerHeight;
      renderer.setSize(vw, vh, false);
      camera.left = 0; camera.right = vw; camera.top = 0; camera.bottom = -vh;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    /* render only while the section is anywhere near the viewport */
    var live = true, io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      live = false;
      io = new IntersectionObserver(function (entries) {
        live = entries.some(function (en) { return en.isIntersecting; });
        canvas.style.visibility = live ? 'visible' : 'hidden';
        if (live) start();
      }, { rootMargin: CFG.MARGIN + 'px 0px' });
      io.observe(root);
    }

    var clock = new THREE.Clock();
    var lastY = window.scrollY || 0;
    var vel = 0, raf = null, dead = false;

    function frame() {
      raf = null;
      if (dead) return;
      var dt = Math.min(clock.getDelta(), 0.05);
      var t = clock.elapsedTime;
      var y = window.scrollY || document.documentElement.scrollTop || 0;

      /* signed scroll velocity, damped so it decays back to 0 (never linearly) */
      var target = clamp((y - lastY) * CFG.VEL_PER_PX, -CFG.VEL_CLAMP, CFG.VEL_CLAMP);
      lastY = y;
      vel = damp(vel, target, CFG.DAMP_VEL, dt);
      if (Math.abs(vel) < 0.0004) vel = 0;

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.ready) { it.mesh.visible = false; continue; }
        var r = it.media.getBoundingClientRect();
        if (r.bottom < -CFG.MARGIN || r.top > vh + CFG.MARGIN || !r.width) {
          it.mesh.visible = false;
          it.x = null;
          continue;
        }
        it.mesh.visible = true;

        var tx = r.left + r.width / 2, ty = -(r.top + r.height / 2);
        if (it.x === null) { it.x = tx; it.y = ty; it.w = r.width; it.h = r.height; }
        it.x = damp(it.x, tx, CFG.DAMP_RECT, dt);
        it.y = damp(it.y, ty, CFG.DAMP_RECT, dt);
        it.w = damp(it.w, r.width, CFG.DAMP_RECT, dt);
        it.h = damp(it.h, r.height, CFG.DAMP_RECT, dt);
        it.px = damp(it.px, it.hovered ? it.ptx : 0, CFG.DAMP_POINTER, dt);
        it.py = damp(it.py, it.hovered ? it.pty : 0, CFG.DAMP_POINTER, dt);
        it.mesh.position.set(it.x + it.px * CFG.POINTER_PX, it.y - it.py * CFG.POINTER_PX, 0);
        it.mesh.scale.set(it.w, it.h, 1);

        /* cover-fit: shrink sampling on whichever axis the texture overflows */
        var pa = it.w / it.h, ta = it.texW / it.texH;
        if (ta > pa) it.mat.uniforms.uRatio.value.set(pa / ta, 1);
        else         it.mat.uniforms.uRatio.value.set(1, ta / pa);

        /* scroll zoom: 1.0 at the viewport edges -> 1 + ZOOM_MAX at the middle */
        var prog = 1 - Math.min(1, Math.abs((r.top + r.height / 2) - vh * 0.5) / (vh * 0.62));
        it.zoom = damp(it.zoom, 1 + CFG.ZOOM_BASE + prog * CFG.ZOOM_MAX, CFG.DAMP_ZOOM, dt);
        /* the ripple calms itself: the envelope decays even while still hovered,
           so the image is crisp again a couple of seconds after the pointer lands */
        var env = it.hovered ? Math.exp(-(now() - it.hoverAt) / CFG.HOVER_TAU) : 0;
        it.hover = damp(it.hover, env, CFG.DAMP_HOVER, dt);
        if (it.hover < 0.002) it.hover = 0;

        var u = it.mat.uniforms;
        u.uSize.value.set(it.w, it.h);
        u.uZoom.value = it.zoom;
        u.uHover.value = it.hover;
        u.uPointer.value.set(it.px, it.py);
        u.uVel.value = vel;
        u.uTime.value = t;
        u.uOpacity.value = parseFloat(getComputedStyle(it.card).opacity) || 0;

        /* the title takes the same velocity value, same sign, same decay */
        if (it.title) {
          it.title.style.transformOrigin = '0 50%';
          it.title.style.transform = 'rotate(' + (vel * CFG.TEXT_ROT).toFixed(3) + 'deg) skewY(' +
            (vel * CFG.TEXT_SKEW).toFixed(3) + 'deg)';
        }

      }

      renderer.render(scene, camera);
      if (live) raf = requestAnimationFrame(frame);
    }

    function start() { if (!raf && !dead && live) raf = requestAnimationFrame(frame); }
    start();

    return {
      destroy: function () {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        if (io) io.disconnect();
        window.removeEventListener('resize', resize);
        root.removeEventListener('pointerover', onOver);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointermove', onMove);
        items.forEach(function (it) {
          if (it.mat.uniforms.uTex.value) it.mat.uniforms.uTex.value.dispose();
          it.mat.dispose();
          if (it.base) it.base.style.opacity = '';
          if (it.title) it.title.style.transform = '';
        });
        geo.dispose();
        renderer.dispose();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  window.HLGallery = { mount: mount, config: CFG };
})();

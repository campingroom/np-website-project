/* <iridescent-trail> — oil-slick satin ribbon that follows the cursor.
   Fixed full-viewport canvas (appended to <body> so page transforms can't
   trap it), clipped every frame to the band between two elements:
     data-zone-from / data-zone-to  CSS selectors (band = from.top → to.bottom)
     data-blend                     mix-blend-mode of the canvas element
     data-width, data-life, data-z  ribbon width px, trail life s, z-index
   Skips entirely on touch/coarse pointers and under prefers-reduced-motion.
   Idles at zero cost: the rAF loop stops when the trail is empty. */
(() => {
  if (window.customElements && customElements.get('iridescent-trail')) return;

  /* oil film interference cycle: pink → violet → blue → cyan → green → yellow */
  const STOPS = [[255, 62, 165], [166, 74, 255], [58, 104, 255], [22, 198, 240],
                 [32, 230, 166], [182, 240, 58], [255, 208, 74], [255, 104, 60]];
  const LN = 512, LUT = new Float32Array(LN * 3);
  for (let i = 0; i < LN; i++) {
    const f = (i / LN) * STOPS.length, k = Math.floor(f), t = f - k;
    const a = STOPS[k % STOPS.length], b = STOPS[(k + 1) % STOPS.length];
    const e = t * t * (3 - 2 * t);
    LUT[i * 3] = a[0] + (b[0] - a[0]) * e;
    LUT[i * 3 + 1] = a[1] + (b[1] - a[1]) * e;
    LUT[i * 3 + 2] = a[2] + (b[2] - a[2]) * e;
  }
  /* slow movement drifts toward the ground's own tone, fast movement pushes
     the full chroma of the ramp — light ground films toward paper white,
     dark ground toward ink so additive blending stays translucent */
  const NEU_LIGHT = [222, 224, 228], NEU_DARK = [24, 26, 32];
  let NEU = NEU_LIGHT;

  function film(u, sat, sheen, alpha) {
    let x = u - Math.floor(u);
    const i = ((x * LN) | 0) * 3;
    let r = NEU[0] + (LUT[i] - NEU[0]) * sat;
    let g = NEU[1] + (LUT[i + 1] - NEU[1]) * sat;
    let b = NEU[2] + (LUT[i + 2] - NEU[2]) * sat;
    if (sheen > 0) { r += (255 - r) * sheen; g += (255 - g) * sheen; b += (255 - b) * sheen; }
    return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + alpha.toFixed(3) + ')';
  }

  class IridescentTrail extends HTMLElement {
    static observedAttributes = ['data-blend', 'data-width', 'data-life', 'data-z'];

    attributeChangedCallback() {
      if (!this.cv) return;
      this.applyBlend();
      this.cv.style.zIndex = this.getAttribute('data-z') || 45;
      this.W = +(this.getAttribute('data-width') || 26);
      this.LIFE = +(this.getAttribute('data-life') || 0.62);
    }

    connectedCallback() {
      if (this.__on) return;
      this.__on = true;
      this.style.display = 'none';
      const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!fine || still) return;

      this.cv = document.createElement('canvas');
      this.cv.setAttribute('aria-hidden', 'true');
      this.cv.style.cssText = 'position:fixed; inset:0; width:100vw; height:100vh;' +
        'pointer-events:none; z-index:' + (this.getAttribute('data-z') || 45) + ';';
      document.body.appendChild(this.cv);
      this.ctx = this.cv.getContext('2d');
      this.applyBlend();
      this.themeWatch = new MutationObserver(() => this.applyBlend());
      this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

      this.W = +(this.getAttribute('data-width') || 26);
      this.LIFE = +(this.getAttribute('data-life') || 0.62);
      this.pts = [];
      this.have = false;      /* follower seeded */
      this.inside = false;
      this.nsp = 0;           /* normalised speed 0..1 */
      this.t0 = performance.now();

      this.onMove = (e) => {
        this.tx = e.clientX; this.ty = e.clientY;
        if (!this.have) { this.fx = this.tx; this.fy = this.ty; this.have = true; }
        const z = this.band();
        this.inside = !!z && e.clientY >= z[0] - 40 && e.clientY <= z[1] + 40;
        if (this.inside) this.kick();
      };
      this.onLeave = () => { this.inside = false; };
      this.onResize = () => { this.size(); };
      addEventListener('pointermove', this.onMove, { passive: true });
      addEventListener('pointerdown', this.onMove, { passive: true });
      document.addEventListener('pointerleave', this.onLeave, { passive: true });
      addEventListener('resize', this.onResize);
      this.size();
    }

    disconnectedCallback() {
      this.__on = false;
      removeEventListener('pointermove', this.onMove);
      removeEventListener('pointerdown', this.onMove);
      document.removeEventListener('pointerleave', this.onLeave);
      removeEventListener('resize', this.onResize);
      cancelAnimationFrame(this.raf);
      if (this.themeWatch) this.themeWatch.disconnect();
      if (this.cv && this.cv.parentNode) this.cv.parentNode.removeChild(this.cv);
    }

    /* on a light ground the film reads as multiply (translucent oil on paper);
       on a dark ground as screen/additive, the way a real thin film glows */
    applyBlend() {
      const want = this.getAttribute('data-blend') || 'auto';
      const dark = this.darkGround();
      const mode = want === 'auto' ? (dark ? 'screen' : 'multiply') : want;
      this.cv.style.mixBlendMode = mode;
      this.additive = mode === 'screen' || mode === 'lighten' || mode === 'plus-lighter';
    }

    darkGround() {
      const th = document.documentElement.getAttribute('data-theme');
      if (th === 'light') return false;
      if (th === 'dark') return true;
      const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
      if (!m) return false;
      return (0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]) / 255 < 0.45;
    }

    size() {
      if (!this.cv) return;
      this.dpr = Math.min(devicePixelRatio || 1, 1.75);
      this.vw = innerWidth; this.vh = innerHeight;
      this.cv.width = Math.round(this.vw * this.dpr);
      this.cv.height = Math.round(this.vh * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    band() {
      const a = document.querySelector(this.getAttribute('data-zone-from') || '[data-hl]');
      const b = document.querySelector(this.getAttribute('data-zone-to') || '#contact');
      if (!a || !b) return null;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return [ra.top, rb.bottom];
    }

    kick() {
      if (this.raf) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    frame = (now) => {
      this.raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
      this.last = now;
      const time = (now - this.t0) / 1000;

      /* smooth follower — the curve comes from chasing the pointer, never
         from the raw jittery samples */
      if (this.have) {
        const k = 1 - Math.exp(-dt * 13);
        const px = this.fx, py = this.fy;
        this.fx += (this.tx - this.fx) * k;
        this.fy += (this.ty - this.fy) * k;
        const sp = Math.hypot(this.fx - px, this.fy - py) / dt;
        this.nsp += (Math.min(1, sp / 1500) - this.nsp) * (1 - Math.exp(-dt * 9));
        if (this.inside) {
          const h = this.pts[0];
          const sy = scrollY;
          if (!h || Math.hypot(this.fx - h.x, this.fy + sy - h.y) > 1.1) {
            this.pts.unshift({ x: this.fx, y: this.fy + sy, t: now, v: this.nsp });
            if (this.pts.length > 72) this.pts.length = 72;
          }
        }
      }
      const life = this.LIFE * 1000;
      while (this.pts.length && now - this.pts[this.pts.length - 1].t > life) this.pts.pop();

      const z = this.band();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.vw, this.vh);
      if (z && this.pts.length > 2) {
        const top = Math.max(0, z[0]), bot = Math.min(this.vh, z[1]);
        if (bot > top) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, top, this.vw, bot - top);
          ctx.clip();
          NEU = this.additive ? NEU_DARK : NEU_LIGHT;
          ctx.globalCompositeOperation = this.additive ? 'lighter' : 'source-over';
          const s = this.resample(now);
          if (s.length > 3) {
            this.ribbon(ctx, s, time, this.W, 0, 0);
            this.ribbon(ctx, s, time, this.W * 0.52, 2.2, 0.36);
            this.head(ctx, s, time);
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.restore();
        }
      }

      if (this.pts.length || this.inside) this.raf = requestAnimationFrame(this.frame);
    };

    /* Catmull-Rom subdivision of the recorded path → smooth spine in viewport
       coords, carrying age + speed per sample */
    resample(now) {
      const p = this.pts, n = p.length, sy = scrollY, out = [];
      const SUB = 3, life = this.LIFE * 1000;
      const at = (i) => p[i < 0 ? 0 : i > n - 1 ? n - 1 : i];
      for (let i = 0; i < n - 1; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        for (let j = 0; j < SUB; j++) {
          const t = j / SUB, t2 = t * t, t3 = t2 * t;
          out.push({
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3) - sy,
            f: Math.max(0, 1 - ((now - p1.t) + (p2.t - p1.t) * t) / life),
            v: p1.v + (p2.v - p1.v) * t
          });
        }
      }
      return out;
    }

    ribbon(ctx, s, time, W, phaseOff, hueOff) {
      const n = s.length;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const c = s[i], a = s[i > 0 ? i - 1 : 0], b = s[i < n - 1 ? i + 1 : n - 1];
        let tx = b.x - a.x, ty = b.y - a.y;
        const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
        c.nx = -ty; c.ny = tx;
        c.ang = Math.atan2(ty, tx);
        if (i > 0) acc += Math.hypot(c.x - s[i - 1].x, c.y - s[i - 1].y);
        c.s = acc;
      }
      for (let i = 0; i < n; i++) {
        const c = s[i], u = i / (n - 1);
        /* the ribbon twists about its own tangent: |cos| pinches it edge-on */
        const ph = c.s * 0.026 - time * 2.1 + phaseOff;
        const cw = Math.cos(ph);
        const env = Math.pow(c.f, 1.2) * Math.min(1, 0.1 + u * 7);
        c.hw = W * env * (0.3 + 0.7 * Math.abs(cw));
        const shift = W * env * 0.34 * Math.sin(ph);
        c.cx = c.x + c.nx * shift; c.cy = c.y + c.ny * shift;
        c.bright = 0.34 + 0.66 * Math.abs(cw);
        c.hue = 0.06 * time + c.s / 520 + c.ang * 0.085 + ph * 0.028 + hueOff + c.v * 0.22;
        c.sat = 0.34 + 0.66 * Math.min(1, c.v * 1.25 + 0.12);
        c.a = (0.1 + 0.42 * c.v) * Math.pow(c.f, 1.15) * c.bright * (this.additive ? 0.6 : 1);
      }
      for (let i = 0; i < n - 1; i++) {
        const c = s[i], d = s[i + 1];
        if (c.hw < 0.12 && d.hw < 0.12) continue;
        const a1x = c.cx + c.nx * c.hw, a1y = c.cy + c.ny * c.hw;
        const a2x = c.cx - c.nx * c.hw, a2y = c.cy - c.ny * c.hw;
        const b1x = d.cx + d.nx * d.hw, b1y = d.cy + d.ny * d.hw;
        const b2x = d.cx - d.nx * d.hw, b2y = d.cy - d.ny * d.hw;
        const g = ctx.createLinearGradient((a1x + b1x) / 2, (a1y + b1y) / 2, (a2x + b2x) / 2, (a2y + b2y) / 2);
        const al = (c.a + d.a) / 2, hu = (c.hue + d.hue) / 2, st = (c.sat + d.sat) / 2;
        g.addColorStop(0, film(hu, st, 0.06, al * 0.75));
        g.addColorStop(0.34, film(hu + 0.055, st, 0.42, al));       /* satin sheen */
        g.addColorStop(0.62, film(hu + 0.12, st, 0.02, al * 1.05));
        g.addColorStop(1, film(hu + 0.2, st, 0.1, al * 0.6));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(a1x, a1y); ctx.lineTo(b1x, b1y); ctx.lineTo(b2x, b2y); ctx.lineTo(a2x, a2y);
        ctx.closePath();
        ctx.fill();
      }
    }

    head(ctx, s, time) {
      const c = s[0];
      const r = this.W * (0.9 + 0.8 * this.nsp);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      const hu = 0.06 * time + c.ang * 0.085 + this.nsp * 0.3;
      g.addColorStop(0, film(hu, 0.25 + 0.6 * this.nsp, 0.5, 0.1 + 0.22 * this.nsp));
      g.addColorStop(1, film(hu + 0.15, 0.5, 0.2, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, 6.2832);
      ctx.fill();
    }
  }
  customElements.define('iridescent-trail', IridescentTrail);
})();

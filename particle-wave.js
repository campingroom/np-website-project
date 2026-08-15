/* <particle-wave> — an interactive liquid dune of small geometric marks.
   Idle, the surface undulates like liquid resting in a vessel; the cursor
   punches a hole through it and a fast drag drags a swirling wake. Marks
   spring back under gravity, splashing over the crest before settling.
   Colours are read from the page theme (dark / light) at runtime.
   Attributes: clamp-to="<selector>" — never grow above that element's top. */
(function () {
  if (customElements.get('particle-wave')) return;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const SHAPES = ['circle', 'square', 'triangle', 'cross', 'plus'];
  const TAB = 8; /* crest lookup resolution, px */

  class ParticleWave extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:block;position:relative;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><canvas></canvas>';
      this.cv = root.querySelector('canvas');
      this.ctx = this.cv.getContext('2d');
      this.parts = [];
      this.tab = [];
      this.t = 0;
      this.m = { x: -9999, y: -9999, px: -9999, py: -9999, vx: 0, vy: 0 };
      this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.onMove = (e) => {
        const r = this.getBoundingClientRect();
        this.m.x = e.clientX - r.left;
        this.m.y = e.clientY - r.top;
      };
      this.onOut = () => { this.m.x = -9999; this.m.y = -9999; };
      window.addEventListener('pointermove', this.onMove, { passive: true });
      window.addEventListener('pointerdown', this.onMove, { passive: true });
      document.addEventListener('pointerleave', this.onOut);
      this.onScroll = () => this.clamp();
      window.addEventListener('scroll', this.onScroll, { passive: true });

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this);
      this.io = new IntersectionObserver((es) => { this.vis = es[0].isIntersecting; this.pump(); }, { rootMargin: '200px' });
      this.io.observe(this);
      this.mo = new MutationObserver(() => this.theme());
      this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      this.theme();
      this.clamp();
      this.resize();
    }

    disconnectedCallback() {
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerdown', this.onMove);
      window.removeEventListener('scroll', this.onScroll);
      document.removeEventListener('pointerleave', this.onOut);
      if (this.ro) this.ro.disconnect();
      if (this.io) this.io.disconnect();
      if (this.mo) this.mo.disconnect();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    attr(n) { return this.getAttribute(n) || this.getAttribute(n.replace(/-/g, '')) || ''; }

    /* the field is a full viewport tall, but never reaches above the element
       it is clamped to (so it can never spill into the section above) */
    clamp() {
      const sel = this.attr('clamp-to');
      const lim = sel ? document.querySelector(sel) : null;
      const host = this.parentElement || this;
      if (!lim || !host) return;
      const stopSel = this.attr('stop-at');
      const stop = stopSel ? document.querySelector(stopSel) : null;
      if (stop) {
        const docH = document.documentElement.scrollHeight;
        const stopTop = stop.getBoundingClientRect().top + window.scrollY;
        const b = Math.max(0, Math.round(docH - stopTop - 26));
        if (Math.abs(parseFloat(host.style.bottom || 0) - b) > 1) host.style.bottom = b + 'px';
      }
      const bottom = host.getBoundingClientRect().bottom + window.scrollY;
      const limTop = lim.getBoundingClientRect().top + window.scrollY;
      const want = Math.max(340, Math.min(window.innerHeight, bottom - limTop));
      if (Math.abs(parseFloat(host.style.height || 0) - want) > 1) host.style.height = want + 'px';
    }

    theme() {
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      this.dark = dark;
      this.ink = dark ? '243,242,242' : '32,30,29';
      this.warm = dark ? '255,106,44' : '236,48,19';
      this.cool = dark ? '76,130,255' : '84,124,214';
      if (this.parts.length) this.tint();
      if (this.reduce) this.draw();
    }

    tint() {
      for (const p of this.parts) {
        const a = (0.18 + p.d * 0.7).toFixed(3);
        const tone = p.tone < 0.1 ? this.warm : p.tone < 0.17 ? this.cool : this.ink;
        p.color = 'rgba(' + tone + ',' + a + ')';
      }
    }

    resize() {
      const r = this.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      this.w = r.width; this.h = r.height;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.build();
      this.pump();
      if (this.reduce) this.draw();
    }

    /* resting crest of the liquid — three drifting sine trains */
    crest(x, t) {
      const u = x / this.w;
      return this.h * (0.2
        + 0.075 * Math.sin(u * Math.PI * 1.7 + 0.7 + t * 0.21)
        + 0.042 * Math.sin(u * Math.PI * 4.3 + 2.1 - t * 0.34)
        + 0.02 * Math.sin(u * Math.PI * 8.9 + 0.3 + t * 0.52));
    }

    crestTable(t) {
      const n = Math.ceil(this.w / TAB) + 2;
      if (this.tab.length !== n) this.tab = new Float32Array(n);
      for (let i = 0; i < n; i++) this.tab[i] = this.crest(i * TAB, t);
    }

    build() {
      const w = this.w, h = this.h;
      const step = Math.max(11, Math.min(18, Math.sqrt((w * h) / 3400)));
      const parts = [];
      this.crestTable(0);
      for (let x = step * 0.5; x < w; x += step) {
        const c0 = this.crest(x, 0);
        const span = Math.max(1, h - c0);
        for (let y = c0; y < h + step; y += step) {
          const d = Math.min(1, Math.max(0, (y - c0) / span));
          if (Math.random() > Math.min(1, 0.05 + d * 1.35)) continue;
          const bx = x + rnd(-3.2, 3.2), by = y + rnd(-3.2, 3.2);
          parts.push({
            bx, by, off: by - c0, x: bx, y: by, vx: 0, vy: 0, d,
            tone: Math.random(),
            s: rnd(4.0, 6.8) + d * 4.8,
            rot: rnd(0, Math.PI),
            shape: SHAPES[(Math.random() * SHAPES.length) | 0]
          });
        }
      }
      this.parts = parts.length > 5200 ? parts.filter(() => Math.random() < 5200 / parts.length) : parts;
      this.tint();
    }

    pump() {
      if (this.reduce || !this.vis || this.raf || !this.parts.length) return;
      const loop = () => {
        if (!this.vis || this.reduce) { this.raf = 0; return; }
        this.step();
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    step() {
      this.t += 1 / 60;
      this.crestTable(this.t);
      const tab = this.tab, w = this.w, h = this.h;
      const m = this.m;
      m.vx = m.x - m.px; m.vy = m.y - m.py;
      m.px = m.x; m.py = m.y;
      if (Math.abs(m.vx) > 220 || Math.abs(m.vy) > 220) { m.vx = 0; m.vy = 0; }
      const RAD = 165, RAD2 = RAD * RAD;
      const live = m.x > -9000;
      const BOUNCE = -0.88;
      for (const p of this.parts) {
        /* the resting surface itself breathes, so the field never sits dead */
        p.by = tab[(p.bx / TAB) | 0] + p.off;

        if (live) {
          const dx = p.x - m.x, dy = p.y - m.y, d2 = dx * dx + dy * dy;
          if (d2 < RAD2 && d2 > 0.5) {
            const d = Math.sqrt(d2), f = 1 - d / RAD;
            const ux = dx / d, uy = dy / d;
            /* swirl: rotate the outward push by the tangential component of the
               pointer's motion, so a fast pass leaves a curling wake */
            let sw = (m.vx * -uy + m.vy * ux) * 0.024;
            sw = Math.max(-1.1, Math.min(1.1, sw));
            const ca = Math.cos(sw), sa = Math.sin(sw);
            const rx = ux * ca - uy * sa, ry = ux * sa + uy * ca;
            const push = f * f * 24.6;
            p.vx += rx * push + m.vx * f * 0.055;
            p.vy += ry * push + m.vy * f * 0.055;
            p.rot += sw * f * 0.3;
          }
        }

        /* spring home + gravity on anything thrown above its resting line */
        p.vx += (p.bx - p.x) * 0.036;
        p.vy += (p.by - p.y) * 0.036;
        if (p.y < p.by) p.vy += 0.075;
        p.vx *= 0.9; p.vy *= 0.9;
        p.x += p.vx; p.y += p.vy;

        /* walls of the vessel: left, right, top and floor all bounce */
        if (p.x < 0) { p.x = -p.x; p.vx *= BOUNCE; p.rot += 0.4; }
        else if (p.x > w) { p.x = w - (p.x - w); p.vx *= BOUNCE; p.rot -= 0.4; }
        if (p.y < 0) { p.y = -p.y; p.vy *= BOUNCE; p.rot += 0.4; }
        else if (p.y > h) { p.y = h - (p.y - h); p.vy *= BOUNCE; }
      }
    }

    draw() {
      const c = this.ctx;
      if (!c || !this.w) return;
      c.clearRect(0, 0, this.w, this.h);

      /* the liquid's own tint under the marks, following the live crest */
      const tab = this.tab.length ? this.tab : (this.crestTable(0), this.tab);
      const g = c.createLinearGradient(0, this.h * 0.18, 0, this.h);
      g.addColorStop(0, 'rgba(' + this.warm + ',0)');
      g.addColorStop(0.55, 'rgba(' + this.warm + ',' + (this.dark ? 0.09 : 0.055) + ')');
      g.addColorStop(1, 'rgba(' + this.cool + ',' + (this.dark ? 0.15 : 0.085) + ')');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, this.h);
      for (let i = 0; i * TAB <= this.w; i++) c.lineTo(i * TAB, tab[i]);
      c.lineTo(this.w, this.h);
      c.closePath();
      c.fill();

      let last = '';
      for (const p of this.parts) {
        if (p.color !== last) { c.fillStyle = p.color; c.strokeStyle = p.color; last = p.color; }
        const s = p.s;
        switch (p.shape) {
          case 'circle':
            c.beginPath(); c.arc(p.x, p.y, s * 0.62, 0, 6.2832); c.fill();
            break;
          case 'square':
            c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
            c.fillRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1); c.restore();
            break;
          case 'triangle':
            c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
            c.beginPath(); c.moveTo(0, -s * 0.8); c.lineTo(s * 0.72, s * 0.62); c.lineTo(-s * 0.72, s * 0.62);
            c.closePath(); c.fill(); c.restore();
            break;
          case 'cross':
            c.save(); c.translate(p.x, p.y); c.rotate(p.rot + 0.785);
            c.lineWidth = Math.max(0.8, s * 0.34);
            c.beginPath(); c.moveTo(-s * 0.7, 0); c.lineTo(s * 0.7, 0); c.moveTo(0, -s * 0.7); c.lineTo(0, s * 0.7);
            c.stroke(); c.restore();
            break;
          default:
            c.save(); c.translate(p.x, p.y); c.rotate(p.rot * 0.2);
            c.lineWidth = Math.max(0.8, s * 0.34);
            c.beginPath(); c.moveTo(-s * 0.72, 0); c.lineTo(s * 0.72, 0); c.moveTo(0, -s * 0.72); c.lineTo(0, s * 0.72);
            c.stroke(); c.restore();
        }
      }
    }
  }

  customElements.define('particle-wave', ParticleWave);
})();

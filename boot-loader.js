/* boot-loader.js — first-paint loader for the school site.
   Runs from <helmet> before the page content paints: hides #dc-root, shows a
   full-screen ink panel with the school wordmark, a real (not faked) progress
   readout, then folds the panel into the school's initial letterform and
   squeezes it away. Fixes the half-loaded flash of text/images on first visit.

   Tunables — every timing/geometry constant lives here. */
(() => {
  if (window.__boot) return;

  const CFG = {
    LETTER:      'N',    /* 'N' | 'S' | 'rule' — shape the panel folds into */
    MIN_MS:      1500,   /* never finish sooner than this (lets the motion read) */
    MAX_MS:      4500,   /* hard cap: reveal even if an asset hangs */
    FAST_MS:     700,    /* repeat visit in the same tab: short version */
    REPEAT_FAST: true,
    FORM_MS:     820,    /* screen → letterform */
    HOLD_MS:     440,    /* beat on the letterform */
    EXIT_MS:     620,    /* letterform → squeezed away */
    REVEAL_MS:   700,    /* content fade-up */
    SPEED:       1,      /* global multiplier */
    /* letterform box, in viewport % */
    BOX: { x0: 34, x1: 66, y0: 26, y1: 74, w: 7.4 }
  };

  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* match the ground the site will actually open on (same key the site stores) */
  let saved = null;
  try { saved = localStorage.getItem('school-site-theme'); } catch (e) {}
  const light = saved ? saved === 'light' : matchMedia('(prefers-color-scheme: light)').matches;
  const GROUND = light ? '#F4F3F2' : '#0A0A0C';
  const INK = light ? '#201E1D' : '#EDEDF0';
  const RULE = light ? 'rgba(32,30,29,.14)' : 'rgba(237,237,240,.16)';
  const ACC = '#EC3013';
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeIn = t => t * t * t * t;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ── letterform outlines (single closed polygon, no counters) ────────── */
  function letterPts(kind) {
    const b = CFG.BOX, { x0, x1, y0, y1, w } = b;
    const wv = w, wh = w * 0.62 * (innerHeight / innerWidth) * (innerWidth / innerHeight) * 1.0;
    const hw = w * (innerWidth / innerHeight) * 0.55;   /* horizontal bar height, kept optically even */
    if (kind === 'S') {
      const ym1 = (y0 + y1) / 2 + hw / 2, ym0 = ym1 - hw;
      return [[x0, y0], [x1, y0], [x1, y0 + hw], [x0 + wv, y0 + hw], [x0 + wv, ym0],
              [x1, ym0], [x1, y1], [x0, y1], [x0, y1 - hw], [x1 - wv, y1 - hw],
              [x1 - wv, ym1], [x0, ym1]];
    }
    if (kind === 'rule') {
      const m = (y0 + y1) / 2;
      return [[x0, m - hw / 2], [x1, m - hw / 2], [x1, m + hw / 2], [x0, m + hw / 2]];
    }
    /* N — left stem, diagonal, right stem */
    const d = (y1 - y0) * 0.46;
    return [[x0, y0], [x0 + wv, y0], [x1 - wv, y1 - d], [x1 - wv, y0], [x1, y0],
            [x1, y1], [x1 - wv, y1], [x0 + wv, y0 + d], [x0 + wv, y1], [x0, y1]];
  }
  /* screen-sized start polygon with the same point count: each target point
     pushed out to the screen edge it belongs to, so the fold reads as one move */
  const screenPts = pts => pts.map(([x, y]) => [x < 50 ? 0 : 100, y < 50 ? 0 : 100]);
  const poly = pts => 'polygon(' + pts.map(p => p[0].toFixed(2) + '% ' + p[1].toFixed(2) + '%').join(',') + ')';
  const mix = (a, b, t) => a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]);

  /* ── DOM ─────────────────────────────────────────────────────────────── */
  const hide = document.createElement('style');
  hide.textContent = '#dc-root{opacity:0} html.boot-lock,html.boot-lock body{overflow:hidden!important}';
  document.head.appendChild(hide);
  document.documentElement.classList.add('boot-lock');

  const el = document.createElement('div');
  el.id = 'boot-loader';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'background:' + GROUND,
    'color:' + INK, 'display:flex', 'flex-direction:column',
    'justify-content:flex-end', 'pointer-events:auto',
    'font-family:Archivo,var(--font-heading),system-ui,sans-serif',
    'clip-path:polygon(0 0,100% 0,100% 100%,0 100%)'
  ].join(';');
  el.innerHTML =
    '<div style="padding:0 clamp(20px,5vw,72px) clamp(28px,5vh,56px); display:flex; align-items:flex-end; justify-content:space-between; gap:24px; flex-wrap:wrap;">' +
      '<div>' +
        '<p style="margin:0 0 12px; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:' + ACC + '; font-weight:700;">โรงเรียนบ้านหนองสระพังโนนสะอาด</p>' +
        '<p style="margin:0; font-weight:800; line-height:1.04; letter-spacing:-.02em; font-size:clamp(20px,3.6vw,44px); text-transform:uppercase; white-space:nowrap;">BANNONGSAPUNG<br>NONSA-ARD <span style="color:' + ACC + ';">SCHOOL</span></p>' +
      '</div>' +
      '<p id="boot-count" style="margin:0; font-weight:800; font-size:clamp(32px,5.4vw,72px); line-height:.9; letter-spacing:-.04em; font-variant-numeric:tabular-nums;">000<span style="font-size:.3em; vertical-align:super; color:' + ACC + '; margin-left:.15em;">%</span></p>' +
    '</div>' +
    '<div style="height:2px; background:' + RULE + ';"><div id="boot-bar" style="height:100%; width:0%; background:' + ACC + ';"></div></div>';
  const mount = () => (document.body || document.documentElement).appendChild(el);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });

  const num = () => el.querySelector('#boot-count');
  const bar = () => el.querySelector('#boot-bar');

  /* ── real load progress: DOM + fonts + images ────────────────────────── */
  let domDone = document.readyState !== 'loading', fontsDone = false, winDone = false;
  document.addEventListener('DOMContentLoaded', () => { domDone = true; }, { once: true });
  addEventListener('load', () => { winDone = true; }, { once: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontsDone = true; });
  else fontsDone = true;

  /* only what the visitor actually sees first: images inside the opening
     viewport. Waiting on window.load would hang on the YouTube iframe and
     lazy images far down the page. */
  function imgRatio() {
    const imgs = document.images;
    let n = 0, ok = 0;
    for (let i = 0; i < imgs.length; i++) {
      const r = imgs[i].getBoundingClientRect();
      if (r.top > innerHeight * 1.2) continue;
      n++;
      if (imgs[i].complete) ok++;
    }
    if (!n) return domDone ? 1 : 0;
    return ok / n;
  }
  function realProgress() {
    if (winDone) return 1;
    return 0.28 * (domDone ? 1 : 0) + 0.26 * (fontsDone ? 1 : 0) + 0.46 * imgRatio();
  }

  const t0 = performance.now();
  const fast = CFG.REPEAT_FAST && sessionStorage.getItem('bnsp-booted') === '1';
  const minMs = (fast ? CFG.FAST_MS : CFG.MIN_MS) * CFG.SPEED;
  let shown = 0, phase = 'load', pStart = 0, from = null, to = null, done = false;
  const dones = [];   /* callbacks the page registers to start its own intro motion */

  function finish() {
    if (done) return;
    done = true;
    try { sessionStorage.setItem('bnsp-booted', '1'); } catch (e) {}
    document.documentElement.classList.remove('boot-lock');
    const root = document.getElementById('dc-root');
    hide.remove();
    if (root && !RM) {
      root.style.transition = 'opacity ' + CFG.REVEAL_MS + 'ms ease, transform ' + (CFG.REVEAL_MS + 160) + 'ms cubic-bezier(.2,.8,.2,1)';
      root.style.opacity = '0'; root.style.transform = 'translateY(18px)';
      requestAnimationFrame(() => { root.style.opacity = '1'; root.style.transform = 'none'; });
      setTimeout(() => { root.style.transition = ''; root.style.transform = ''; }, CFG.REVEAL_MS + 400);
    }
    el.remove();
    dones.splice(0).forEach(fn => { try { fn(); } catch (e) {} });
  }

  setTimeout(finish, CFG.MAX_MS + 2500);

  if (RM) { setTimeout(finish, 250); }
  else requestAnimationFrame(function step(now) {
    if (done) return;
    let t = now - t0;
    /* the panel mounts on DOMContentLoaded; until then there is nothing to
       write the readout into — wait, never throw */
    if (!num() || !bar()) { requestAnimationFrame(step); return; }
    if (phase === 'load') {
      /* eased chase toward whichever is lower: real progress, or the time floor */
      const target = Math.min(realProgress(), Math.max(0.06, t / minMs)) * 100;
      shown += (target - shown) * 0.08;
      if (t > CFG.MAX_MS) shown = 100;
      if (t > minMs && realProgress() > 0.985) shown += (100 - shown) * 0.14;
      const p = Math.min(100, Math.round(shown));
      num().firstChild.textContent = String(p).padStart(3, '0');
      bar().style.width = p + '%';
      if (p >= 100) {
        phase = 'form'; pStart = now;
        to = letterPts(CFG.LETTER); from = screenPts(to);
        num().style.transition = 'opacity .3s ease'; num().style.opacity = '0';
        const head = el.querySelector('div');
        head.style.transition = 'opacity .3s ease'; head.style.opacity = '0';
        /* the letterform lands as a red poster shape on either ground */
        el.style.transition = 'background-color .38s ease';
        el.style.background = ACC;
      }
    } else if (phase === 'form') {
      const k = Math.min(1, (now - pStart) / (CFG.FORM_MS * CFG.SPEED));
      el.style.clipPath = poly(mix(from, to, easeInOut(k)));
      if (k >= 1) { phase = 'hold'; pStart = now; }
    } else if (phase === 'hold') {
      if (now - pStart > CFG.HOLD_MS * CFG.SPEED) {
        phase = 'exit'; pStart = now;
        from = to;
        /* squeeze the letter into the 2px rule at its own left edge, then off */
        to = from.map(p => [CFG.BOX.x0, p[1]]);
      }
    } else if (phase === 'exit') {
      const k = Math.min(1, (now - pStart) / (CFG.EXIT_MS * CFG.SPEED));
      const e = easeIn(k);
      el.style.clipPath = poly(mix(from, to, easeOut(Math.min(1, k * 1.6))));
      el.style.opacity = String(1 - e);
      if (k >= 1) return finish();
    }
    if (!done) requestAnimationFrame(step);
  });

  /* if anything above throws mid-sequence the page must still appear */
  addEventListener('error', (e) => {
    if (!done && String(e && e.filename || '').indexOf('boot-loader') >= 0) finish();
  });

  window.__boot = {
    configure(o) { Object.assign(CFG, o || {}); },
    abort: finish,
    get finished() { return done; },
    onDone(fn) { if (done) fn(); else dones.push(fn); }
  };
})();

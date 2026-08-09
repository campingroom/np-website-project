/* Dotted-earth globe: drag to rotate, inertia, comet arcs, projected HTML labels.
   window.SchoolGlobe.mount(opts) -> { destroy() }
   opts: canvas, wrap, overlay, labels() -> [HTMLElement], spots:[{lat,lon}],
         arcs:[[i,j]], rotY, rotX, spin, reduced() -> bool,
         focus:{lat,lon}, scrollFocus:bool, converge:[{lat,lon}],
         pin:() -> HTMLElement, pinMaxX:0..1, atmo:[hex,hex], zoom:[far,near]      */
(function () {
  var LAND_MASK = 'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-water.png';

  function latLon(THREE, lat, lon, r) {
    var phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta));
  }

  function mount(opts) {
    var THREE = window.THREE;
    if (!THREE || !opts.canvas) return { destroy: function () {} };
    var canvas = opts.canvas, wrap = opts.wrap || canvas.parentElement;
    var reduced = opts.reduced || function () { return false; };
    var dead = false, R = 2.4;
    var atmo = opts.atmo || [0x2a5ac8, 0xff6a2c];
    var zoom = opts.zoom || [8.6, 8.6];

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, zoom[0]);
    var group = new THREE.Group();
    scene.add(group);

    var oc = opts.ocean != null ? opts.ocean : 0x070912;
    group.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 64),
      Array.isArray(oc)
        ? new THREE.ShaderMaterial({
          uniforms: { d: { value: new THREE.Color(oc[0]) }, l: { value: new THREE.Color(oc[1]) } },
          vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'varying vec3 vN; uniform vec3 d; uniform vec3 l; void main(){ float f = pow(1.0 - abs(vN.z), 2.6); float lam = clamp(dot(normalize(vec3(-0.45,0.55,0.7)), vN) * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(d, l, max(f, pow(lam, 1.6) * 0.7)), 1.0); }'
        })
        : new THREE.MeshBasicMaterial({ color: oc })));

    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * (opts.atmoSize || 1.07), 48, 48),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: { c1: { value: new THREE.Color(atmo[0]) }, c2: { value: new THREE.Color(atmo[1]) }, s: { value: opts.atmoStrength || 0.5 } },
        vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vN; uniform vec3 c1; uniform vec3 c2; uniform float s; void main(){ float i = pow(1.0 - abs(vN.z), 4.5); vec3 col = mix(c1, c2, smoothstep(0.72, 1.0, i)); gl_FragColor = vec4(col, i * s); }'
      })));

    /* starfield + drifting near-field motes */
    var starGroup = new THREE.Group();
    scene.add(starGroup);
    var sPos = [];
    for (var i = 0; i < (opts.stars || 460); i++) {
      var v = new THREE.Vector3().setFromSphericalCoords(
        18 + Math.random() * 16, Math.acos(2 * Math.random() - 1), Math.random() * Math.PI * 2);
      sPos.push(v.x, v.y, v.z);
    }
    starGroup.add(new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3)),
      new THREE.PointsMaterial({ color: 0xbfd0ff, size: opts.starSize || 0.055, transparent: true, opacity: 0.6 })));

    var motes = null;
    if (opts.motes !== false) {
      var mPos = [];
      for (var mi = 0; mi < 120; mi++) {
        mPos.push((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, 3 + Math.random() * 3.4);
      }
      motes = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3)),
        new THREE.PointsMaterial({
          color: 0x9fe8e2, size: 0.075, transparent: true, opacity: 0.42,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
      scene.add(motes);
    }

    var spots = opts.spots || [];
    var spotVecs = spots.map(function (s) { return latLon(THREE, s.lat, s.lon, R * 1.012); });
    if (spotVecs.length) {
      group.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(spotVecs),
        new THREE.PointsMaterial({
          color: 0xff6a2c, size: 0.16, transparent: true, sizeAttenuation: true,
          blending: THREE.AdditiveBlending, depthWrite: false
        })));
    }

    /* focus target ------------------------------------------------------- */
    var focus = opts.focus ? latLon(THREE, opts.focus.lat, opts.focus.lon, R * 1.012) : null;
    var focusMark = null;
    if (focus) {
      focusMark = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([focus.clone()]),
        new THREE.PointsMaterial({
          color: 0x7ff0e0, size: 0.34, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
        }));
      group.add(focusMark);
    }

    function arcLine(p1, p2, lift, color) {
      var mid = p1.clone().add(p2).multiplyScalar(0.5).normalize()
        .multiplyScalar(R + p1.distanceTo(p2) * lift);
      var pts = new THREE.QuadraticBezierCurve3(p1, mid, p2).getPoints(160);
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: color, transparent: true, opacity: opts.arcTrail != null ? opts.arcTrail : 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false
      })));
      var hgeo = new THREE.BufferGeometry().setFromPoints(pts);
      hgeo.setDrawRange(0, 0);
      var head = new THREE.Line(hgeo, new THREE.LineBasicMaterial({
        color: color, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      group.add(head);
      group.add(new THREE.Points(hgeo, new THREE.PointsMaterial({
        color: opts.arcGlow || color, size: opts.arcSize || 0.06, transparent: true, opacity: 0.95,
        sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false
      })));
      return head;
    }

    var arcs = (opts.arcs || []).map(function (pair, idx) {
      var line = arcLine(latLon(THREE, spots[pair[0]].lat, spots[pair[0]].lon, R),
        latLon(THREE, spots[pair[1]].lat, spots[pair[1]].lon, R), 0.42, opts.arcColor || 0xffffff);
      return { line: line, n: 161, head: -idx * 40, speed: 0.9, tail: 34 };
    });

    if (focus && opts.converge) {
      opts.converge.forEach(function (s, idx) {
        var line = arcLine(latLon(THREE, s.lat, s.lon, R), focus.clone().setLength(R), 0.5, opts.arcColor || 0xffffff);
        arcs.push({
          line: line, n: 161, head: -idx * 26 - 20,
          speed: 1.25 + (idx % 3) * 0.28, tail: 26
        });
      });
    }

    /* land dots */
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (dead) return;
      var w = 720, h = 360, c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data, dark = 0, total = w * h;
      for (var k = 0; k < total; k++) if (data[k * 4] < 110) dark++;
      var darkIsLand = dark / total < 0.5;
      var land = [], lc = [], cityP = [[], [], []], cityC = [[], [], []], rows = opts.rows || 180;
      var la = opts.landA || [0.22, 0.58, 1.0], lb = opts.landB || [0.44, 0.88, 1.0];
      for (var iy = 0; iy < rows; iy++) {
        var lat = 90 - (iy + 0.5) * (180 / rows);
        var cols = Math.max(8, Math.round(rows * 2 * Math.cos(lat * Math.PI / 180)));
        for (var ix = 0; ix < cols; ix++) {
          var lon = -180 + (ix + 0.5) * (360 / cols);
          var px = Math.min(w - 1, Math.floor((lon + 180) / 360 * w));
          var py = Math.min(h - 1, Math.floor((90 - lat) / 180 * h));
          var val = data[(py * w + px) * 4];
          if (!(darkIsLand ? val < 110 : val > 145)) continue;
          var p = latLon(THREE, lat, lon, R);
          land.push(p.x, p.y, p.z);
          var t = Math.min(1, Math.abs(lat) / 70);
          lc.push(la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t);
          var isLand = function (qx, qy) {
            qx = (qx + w) % w; qy = Math.max(0, Math.min(h - 1, qy));
            var vv = data[(qy * w + qx) * 4];
            return darkIsLand ? vv < 110 : vv > 145;
          };
          var coastal = !(isLand(px - 3, py) && isLand(px + 3, py) && isLand(px, py - 3) && isLand(px, py + 3));
          var rate = coastal ? (opts.coastRate || 0.03) : (opts.cityRate || 0.03);
          if (Math.random() < rate) {
            var b = Math.floor(Math.random() * 3);
            cityP[b].push(p.x * 1.003, p.y * 1.003, p.z * 1.003);
            var warm = Math.random();
            var cb = opts.cityRGB || [1.0, 0.62, 0.24];
            cityC[b].push(cb[0], cb[1] + warm * 0.22, cb[2] + warm * 0.2);
          }
        }
      }
      var mk = function (pos, col, size, additive) {
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        return new THREE.Points(g, new THREE.PointsMaterial({
          size: size, vertexColors: true, transparent: true, sizeAttenuation: true, depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        }));
      };
      group.add(mk(land, lc, opts.landSize || 0.034, !!opts.landGlow));
      cities = cityP.map(function (pos, i) {
        var pts = mk(pos, cityC[i], 0.085, true);
        group.add(pts);
        return pts;
      });
    };
    img.src = LAND_MASK;
    var cities = null;

    /* drag */
    var rotY = opts.rotY != null ? opts.rotY : -1.9;
    var rotX = opts.rotX != null ? opts.rotX : 0.28;
    var spin = opts.spin != null ? opts.spin : 0.0013;
    var baseY = rotY, baseX = rotX, offY = 0, offX = 0, dragged = false;
    var targetY = baseY, targetX = baseX;
    if (focus && opts.scrollFocus) {
      targetY = Math.atan2(-focus.x, focus.z);
      targetX = Math.max(-0.72, Math.min(0.72, opts.focus.lat * Math.PI / 180 + (opts.tilt || 0)));
      baseY = targetY - (opts.sweep != null ? opts.sweep : 1.5);
      baseX = targetX - 0.22;
      rotY = baseY; rotX = baseX;
    }
    var velY = 0, velX = 0, last = null;
    var down = function (e) {
      last = { x: e.clientX, y: e.clientY };
      dragged = true;
      canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    };
    var move = function (e) {
      if (!last) return;
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      velY = dx * 0.0045; velX = dy * 0.0035;
      offY += velY;
      offX = Math.max(-0.72, Math.min(0.72, offX + velX));
    };
    var up = function (e) {
      last = null; canvas.style.cursor = 'grab';
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);

    var zNow = zoom[0];
    function resize() {
      var box = wrap.getBoundingClientRect();
      var w = Math.max(1, box.width), h = Math.max(1, box.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    var ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    function scrollP() {
      var b = wrap.getBoundingClientRect();
      var vh = window.innerHeight || 800;
      var start = vh * 0.98, end = Math.max(60, vh * 0.5 - b.height * 0.42);
      var p = (start - b.top) / Math.max(1, start - end);
      p = Math.max(0, Math.min(1, p));
      return p * p * (3 - 2 * p);
    }

    function labels() {
      var els = opts.labels ? opts.labels() : null;
      var ov = typeof opts.overlay === 'function' ? opts.overlay() : opts.overlay;
      if (!els || !ov) return;
      var box = ov.getBoundingClientRect();
      var maxLabels = opts.maxLabels || 3;
      var items = [];
      spotVecs.forEach(function (v, i) {
        var el = els[i];
        if (!el) return;
        var p = v.clone().applyEuler(group.rotation);
        var s = p.clone().project(camera);
        items.push({
          el: el, z: p.z,
          x: (s.x * 0.5 + 0.5) * box.width,
          y: (-s.y * 0.5 + 0.5) * box.height
        });
      });
      items.sort(function (a, b) { return b.z - a.z; });
      var placed = [];
      items.forEach(function (it, rank) {
        if (it.z <= 0.35 || rank >= maxLabels) { it.el.style.opacity = '0'; return; }
        var w = it.el.offsetWidth || 180, h = it.el.offsetHeight || 44;
        var x = Math.max(w / 2 + 10, Math.min(box.width - w / 2 - 10, it.x));
        var y = Math.max(h * 1.4 + 10, Math.min(box.height - 10, it.y));
        placed.forEach(function (q) {
          if (Math.abs(x - q.x) < (w + q.w) / 2 && Math.abs(y - q.y) < (h + q.h) * 0.6) y = q.y + h + 12;
        });
        y = Math.max(h * 1.4 + 10, Math.min(box.height - 10, y));
        placed.push({ x: x, y: y, w: w, h: h });
        it.el.style.transform = 'translate(-50%,-140%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        it.el.style.opacity = '1';
      });
    }

    function pinPlace() {
      var el = typeof opts.pin === 'function' ? opts.pin() : opts.pin;
      var ov = typeof opts.overlay === 'function' ? opts.overlay() : opts.overlay;
      if (!el || !ov || !focus) return;
      var box = ov.getBoundingClientRect();
      var p = focus.clone().applyEuler(group.rotation);
      var s = p.clone().project(camera);
      var w = el.offsetWidth || 230, h = el.offsetHeight || 88;
      var maxX = box.width * (opts.pinMaxX != null ? opts.pinMaxX : 1);
      var x = Math.max(w / 2 + 8, Math.min(maxX - w / 2 - 8, (s.x * 0.5 + 0.5) * box.width));
      var y = Math.max(h + 22, Math.min(box.height - 16, (-s.y * 0.5 + 0.5) * box.height));
      el.style.transform = 'translate(-50%,-118%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      var vis = p.z > 0.15;
      el.style.opacity = vis ? '1' : '0';
      el.style.pointerEvents = vis ? 'auto' : 'none';
    }

    var t0 = performance.now();
    function loop() {
      if (dead) return;
      requestAnimationFrame(loop);
      var low = reduced();
      var t = (performance.now() - t0) / 1000;
      if (!last) {
        velY *= 0.955; velX *= 0.94;
        if (Math.abs(velY) < 0.0006) velY = 0;
        if (Math.abs(velX) < 0.0004) velX = 0;
        offY += velY + (low || (opts.scrollFocus && !dragged) ? 0 : spin);
        offX = Math.max(-0.72, Math.min(0.72, offX + velX));
      }
      if (opts.scrollFocus && focus) {
        var p = low ? 1 : scrollP();
        rotY = baseY + (targetY - baseY) * p;
        rotX = baseX + (targetX - baseX) * p;
        var z = zoom[0] + (zoom[1] - zoom[0]) * p;
        zNow += (z - zNow) * 0.09;
        camera.position.z = zNow;
      }
      group.rotation.y = rotY + offY;
      group.rotation.x = Math.max(-0.85, Math.min(0.85, rotX + offX));
      if (!low) {
        starGroup.rotation.y += 0.00035;
        starGroup.rotation.x = Math.sin(t * 0.05) * 0.04;
        if (motes) {
          motes.rotation.z = t * 0.014;
          motes.material.opacity = 0.34 + Math.sin(t * 0.9) * 0.08;
        }
        if (cities) cities.forEach(function (c, i) {
          c.material.size = 0.082 + Math.sin(t * 1.5 + i * 2.1) * 0.03;
          c.material.opacity = 0.78 + Math.sin(t * 1.5 + i * 2.1) * 0.22;
        });
        if (focusMark) focusMark.material.size = 0.3 + Math.sin(t * 2.4) * 0.12;
        arcs.forEach(function (a) {
          a.head += a.speed;
          if (a.head > a.n + 90) a.head = -30;
          var end = Math.max(0, Math.min(a.n, Math.round(a.head)));
          var start = Math.max(0, end - a.tail);
          a.line.geometry.setDrawRange(start, Math.max(0, end - start));
        });
      }
      labels();
      pinPlace();
      renderer.render(scene, camera);
    }
    loop();

    return {
      destroy: function () {
        dead = true;
        ro.disconnect();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('pointerleave', up);
        renderer.dispose();
      }
    };
  }

  window.SchoolGlobe = { mount: mount };
})();

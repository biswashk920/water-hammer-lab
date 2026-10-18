/* Self-contained 3D renderer for the water hammer simulator.
   Canvas 2D + painter's algorithm (no libraries). Two views:
   - scene:   pipe on terrain, reservoir, valve, surge tank, pressure curtain (hydraulic grade line), flow particles, burst
   - surface: pressure head P(x, t) as a 3D surface with a moving time cursor
   Scene units: pipe length = 100 units; vertical scale = (100/L) * vex per metre (heads and elevations share the same scale). */
(function (root) {
  const TAU = Math.PI * 2, rnd = Math.random, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), mix = (a, b, t) => a + (b - a) * t;
  const camScene = { yaw: -0.62, pitch: 0.42, dist: 130, tx: 42, ty: 0, tz: 12, d0: 130 };
  const camSurf = { yaw: -0.55, pitch: 0.52, dist: 178, tx: 50, ty: 35, tz: 6 };
  const opt = { vex: 2, bulge: 6, ribbon: true, flow: true, env: true, cut: false, auto: false };
  let cam = camScene, mode = 'scene', dragging = false;
  const flow = [], spray = [], stats = { items: 0 };
  for (let i = 0; i < 260; i++) flow.push({ s: rnd(), r: Math.sqrt(rnd()) * 0.7, a: rnd() * TAU });

  const BASE = [214, 222, 228], RED = [200, 69, 45], BLUE = [31, 111, 168], AMB = [208, 138, 29], DRED = [163, 40, 26];
  const ramp = (u) => { u = clamp(u, -1, 1); const c = u < 0 ? BLUE : RED, k = Math.abs(u); return [mix(BASE[0], c[0], k), mix(BASE[1], c[1], k), mix(BASE[2], c[2], k)]; };
  const rgba = (c, s, a) => `rgba(${(c[0] * s) | 0},${(c[1] * s) | 0},${(c[2] * s) | 0},${a})`;

  function basis(w, h, jit) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const tx = cam.tx + (jit ? jit.x : 0), tz = cam.tz + (jit ? jit.z : 0);
    const ex = tx + cam.dist * sy * cp, ey = cam.ty - cam.dist * cy * cp, ez = tz + cam.dist * sp;
    let fx = tx - ex, fy = cam.ty - ey, fz = tz - ez; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry); rx /= rl; ry /= rl;
    return { ex, ey, ez, fx, fy, fz, rx, ry, ux: ry * fz, uy: -rx * fz, uz: rx * fy - ry * fx, foc: Math.min((h / 2) / Math.tan(0.35), (w / 2) / 0.78), w, h };   // fit by height on wide canvases, by width on narrow ones
  }
  const PR = (B, x, y, z) => {
    const vx = x - B.ex, vy = y - B.ey, vz = z - B.ez, d = vx * B.fx + vy * B.fy + vz * B.fz, k = B.foc / Math.max(d, 1);
    return [B.w / 2 + (vx * B.rx + vy * B.ry) * k, B.h / 2 - (vx * B.ux + vy * B.uy + vz * B.uz) * k, d];
  };
  function poly(items, B, pts, fill, stroke, lw) {
    let d = 0; const q = new Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) { const p = PR(B, pts[i][0], pts[i][1], pts[i][2]); if (p[2] < 2) return; q[2 * i] = p[0]; q[2 * i + 1] = p[1]; d += p[2]; }
    items.push({ d: d / pts.length, k: 0, q, f: fill, s: stroke, lw: lw || 1 });
  }
  function seg(items, B, a, b, col, lw, overlay) {
    const p = PR(B, a[0], a[1], a[2]), r = PR(B, b[0], b[1], b[2]); if (p[2] < 2 || r[2] < 2) return;
    items.push({ d: (p[2] + r[2]) / 2, k: overlay ? 3 : 1, q: [p[0], p[1], r[0], r[1]], s: col, lw });
  }
  function dot(items, B, x, y, z, r, fill) { const p = PR(B, x, y, z); if (p[2] < 2) return; items.push({ d: p[2], k: 2, q: [p[0], p[1], Math.max(0.6, r * B.foc / p[2])], f: fill }); }
  function flush(ctx, items) {
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.k === 0) {
        const q = it.q; ctx.beginPath(); ctx.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]); ctx.closePath();
        ctx.fillStyle = it.f; ctx.fill(); if (it.s) { ctx.strokeStyle = it.s; ctx.lineWidth = it.lw; ctx.stroke(); }
      } else if (it.k === 2) { ctx.fillStyle = it.f; ctx.beginPath(); ctx.arc(it.q[0], it.q[1], it.q[2], 0, TAU); ctx.fill(); }
    }
    for (const it of items) if (it.k === 1 || it.k === 3) {   // lines last (overlay lines on top)
      ctx.strokeStyle = it.s; ctx.lineWidth = it.lw; ctx.beginPath(); ctx.moveTo(it.q[0], it.q[1]); ctx.lineTo(it.q[2], it.q[3]); ctx.stroke();
    }
  }
  const niceStep = (r) => { const e = Math.pow(10, Math.floor(Math.log10(r))), q = r / e; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * e; };
  const scale = (S) => { const sc = 100 / S.p.L; return { sc, zs: sc * opt.vex }; };
  const label = (ctx, B, x, y, z, text, col) => { const p = PR(B, x, y, z); if (p[2] < 2) return; ctx.fillStyle = col || '#13232f'; ctx.fillText(text, p[0] - ctx.measureText(text).width / 2, p[1]); };

  /* ---------------- particles ---------------- */
  function update(dt, c) {
    const S = c.S, A = c.A; if (!S) return; const W = S.W, N = W - 1, n = c.n, { sc, zs } = scale(S), p = S.p;
    if (opt.auto && !dragging) cam.yaw += dt * 0.25;
    if (mode !== 'scene') return;
    if (c.playing && opt.flow && S.Qf) {
      const rate = 0.1 * c.spd;
      for (const q of flow) { const i = Math.round(clamp(q.s, 0, 1) * N), v = S.Qf[n * W + i] / S.Q0; q.s += v * rate * dt; if (q.s > 1) q.s -= 1; if (q.s < 0) q.s += 1; }
    }
    const emit = (rate, f) => { for (let k = Math.floor(rate * dt + rnd()); k > 0 && spray.length < 1200; k--) spray.push(f()); };
    const tau = MOC.tau(n * S.dt, p.Tc, p.law), v = S.Q0 ? S.Qv[n] / S.Q0 : 0;
    if (c.playing && tau > 0.03 && v > 0.02) emit(170 * v, () => ({ x: 103 + rnd() * 2, y: (rnd() - 0.5) * 2, z: 0.2 + (rnd() - 0.5) * 2, vx: 14 + rnd() * 10, vy: (rnd() - 0.5) * 4, vz: (rnd() - 0.2) * 3, life: 0, max: 1.6, c: 0 }));
    if (c.age != null && A.burst) {
      const b = A.burst.i, x = b / N * 100, zc = S.z[b] * zs, rate = c.age < 2 ? 340 : 140;
      emit(rate, () => ({ x: x + (rnd() - 0.5) * 3, y: (rnd() - 0.5) * 3, z: zc + 2, vx: (rnd() - 0.5) * 22, vy: (rnd() - 0.5) * 22, vz: 28 + rnd() * 30, life: 0, max: 2.4, c: 1 }));
    }
    if (S.tank && c.playing !== undefined) {
      const T = S.tank, zb = S.z[T.k] * zs + 2, zt = Math.max(T.top * zs, zb + 1), full = T.spill >= 0 && n >= T.spill && T.Z[n] >= T.top - 1e-9;
      if (full) { const rt = clamp(2.2 + 0.5 * p.tD, 3, 7), xt = T.x / p.L * 100; emit(120, () => { const a = rnd() * TAU; return { x: xt + Math.cos(a) * rt, y: Math.sin(a) * rt, z: zt, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, vz: 2, life: 0, max: 2.2, c: 0 }; }); }
    }
    for (const q of spray) { q.vz -= 55 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.life += dt; }
    for (let i = spray.length - 1; i >= 0; i--) if (spray[i].life > spray[i].max || spray[i].z < -60) spray.splice(i, 1);
  }

  /* ---------------- scene ---------------- */
  function drawScene(ctx, w, h, c) {
    const S = c.S, A = c.A, p = S.p, W = S.W, N = W - 1, n = c.n, f = S.field, z = S.z, { sc, zs } = scale(S), rp = 2.8;
    const jit = (c.age != null && c.age < 0.5 && !c.reduce) ? { x: (rnd() - 0.5) * 1.5 * (1 - c.age / 0.5), z: (rnd() - 0.5) * 1.5 * (1 - c.age / 0.5) } : null;
    const B = basis(w, h, jit), items = [], ground = [], K = 14, M = Math.min(N, 120), rup = !!A.burst && n >= A.end;
    const idx = [], X = [], ZC = [], U = [], R = [], COL = [], VAPz = [];
    for (let m = 0; m <= M; m++) {
      const i = Math.round(m * N / M), u = (f[n * W + i] - f[i]) / A.rng, P = f[n * W + i] - z[i], fi = P > 0 ? p.sy / MOC.sigma(P, p) : Infinity;
      idx[m] = i; X[m] = i / N * 100; ZC[m] = z[i] * zs; U[m] = u; R[m] = Math.max(0.6 * rp, rp * (1 + 0.04 * opt.bulge * u));
      let col = ramp(u); if (fi <= 1) col = DRED; else if (fi < p.fosreq) col = [mix(col[0], AMB[0], 0.55), mix(col[1], AMB[1], 0.55), mix(col[2], AMB[2], 0.55)];
      COL[m] = col; VAPz[m] = (z[i] + MOC.VAP(p.rho)) * zs;
    }
    // terrain
    const gz = ZC.map((v, m) => v - rp - 0.5);
    for (let m = 0; m < M; m++) poly(ground, B, [[X[m], -22, gz[m]], [X[m + 1], -22, gz[m + 1]], [X[m + 1], 22, gz[m + 1]], [X[m], 22, gz[m]]], (m & 1) ? 'rgb(176,184,168)' : 'rgb(170,178,162)');
    for (let k = 0; k <= 10; k++) { const m = Math.round(k * M / 10); seg(ground, B, [X[m], -22, gz[m]], [X[m], 22, gz[m]], 'rgba(120,132,118,.6)', 1); }
    for (const y of [-11, 0, 11]) for (let m = 0; m < M; m++) seg(ground, B, [X[m], y, gz[m]], [X[m + 1], y, gz[m + 1]], 'rgba(120,132,118,.45)', 1);
    // reservoir
    const zf = gz[0] - 3.5, zw = p.Hres * zs;
    poly(ground, B, [[-34, -18, zf], [-1, -18, zf], [-1, 18, zf], [-34, 18, zf]], 'rgb(150,158,146)');
    const wall = (a, b, fill) => poly(items, B, [[a[0], a[1], zf], [b[0], b[1], zf], [b[0], b[1], zw], [a[0], a[1], zw]], fill, 'rgba(90,110,125,.5)', 1);
    wall([-34, 18], [-1, 18], 'rgba(110,170,215,.42)'); wall([-34, -18], [-34, 18], 'rgba(110,170,215,.40)');
    wall([-1, -18], [-1, 18], 'rgba(110,170,215,.45)'); wall([-34, -18], [-1, -18], 'rgba(110,170,215,.28)');
    poly(items, B, [[-34, -18, zw], [-1, -18, zw], [-1, 18, zw], [-34, 18, zw]], 'rgba(90,150,205,.55)', 'rgba(60,110,160,.8)', 1.5);
    // pipe wall
    const sh = [], phi = []; for (let j = 0; j < K; j++) { const a = (j + 0.5) / K * TAU; phi[j] = a; sh[j] = 0.55 + 0.45 * clamp(-0.45 * Math.cos(a) + 0.85 * Math.sin(a), 0, 1); }
    const mb = rup ? Math.round(A.burst.i * M / N) : -9;
    for (let m = 0; m < M; m++) {
      const zc = (ZC[m] + ZC[m + 1]) / 2, phiCam = Math.atan2(B.ez - zc, B.ey), a0 = COL[m], col = [(a0[0] + COL[m + 1][0]) / 2, (a0[1] + COL[m + 1][1]) / 2, (a0[2] + COL[m + 1][2]) / 2];
      for (let j = 0; j < K; j++) {
        const j2 = j + 1, c1 = Math.cos(j / K * TAU), s1 = Math.sin(j / K * TAU), c2 = Math.cos(j2 / K * TAU), s2 = Math.sin(j2 / K * TAU);
        if (rup && (m === mb || m === mb - 1) && Math.abs(phi[j] - Math.PI / 2) < 0.95) continue;
        if (opt.cut) { let d = Math.abs(phi[j] - phiCam); d = Math.min(d, TAU - d); if (d < 1.0) {
          const r0 = R[m] * 0.88, r1 = R[m + 1] * 0.88;
          poly(items, B, [[X[m], r0 * c1, ZC[m] + r0 * s1], [X[m + 1], r1 * c1, ZC[m + 1] + r1 * s1], [X[m + 1], r1 * c2, ZC[m + 1] + r1 * s2], [X[m], r0 * c2, ZC[m] + r0 * s2]], rgba(col, 0.5, 0.9));
          continue; } }
        poly(items, B, [[X[m], R[m] * c1, ZC[m] + R[m] * s1], [X[m + 1], R[m + 1] * c1, ZC[m + 1] + R[m + 1] * s1], [X[m + 1], R[m + 1] * c2, ZC[m + 1] + R[m + 1] * s2], [X[m], R[m] * c2, ZC[m] + R[m] * s2]], rgba(col, sh[j], 0.8));
      }
    }
    // rupture petals
    if (rup) {
      const age = c.age == null ? 3 : c.age, th = Math.min(age / 0.5, 1) * 1.15, xb = X[mb], zb = ZC[mb] + R[mb], Lp = 6, hy = 3.6, wx = 2.2;
      const pet = (hx, hy0, dx, dy) => poly(items, B, [[hx, hy0, zb], [hx + dx * 0.6, hy0 + dy * 0.6, zb + 1.6], [hx + dx * Lp * Math.cos(th), hy0 + dy * Lp * Math.cos(th), zb + Lp * Math.sin(th)], [hx - dy * 0.0, hy0 + dx * 0.0, zb]], 'rgba(176,56,38,.95)', 'rgb(90,20,12)', 1);
      pet(xb - wx, -hy, -1, 0); pet(xb - wx, hy, -1, 0); pet(xb + wx, -hy, 1, 0); pet(xb + wx, hy, 1, 0);
      pet(xb - wx, -hy, 0, -1); pet(xb + wx, -hy, 0, -1); pet(xb - wx, hy, 0, 1); pet(xb + wx, hy, 0, 1);
      if (c.age != null && c.age < 1) { const rr = c.age * 50; for (let k = 0; k < 28; k++) { const a1 = k / 28 * TAU, a2 = (k + 1) / 28 * TAU; seg(items, B, [xb + Math.cos(a1) * rr, Math.sin(a1) * rr, gz[mb] + 0.3], [xb + Math.cos(a2) * rr, Math.sin(a2) * rr, gz[mb] + 0.3], `rgba(208,138,29,${1 - c.age})`, 3, true); } }
    }
    // pressure curtain, hydraulic grade line, envelopes, vapor limit
    if (opt.ribbon) {
      for (let m = 0; m < M; m++) {
        const t0 = f[n * W + idx[m]] * zs, t1 = f[n * W + idx[m + 1]] * zs, cc = ramp((U[m] + U[m + 1]) / 2);
        poly(items, B, [[X[m], 0, ZC[m]], [X[m + 1], 0, ZC[m + 1]], [X[m + 1], 0, t1], [X[m], 0, t0]], rgba(cc, 0.95, 0.3));
        seg(items, B, [X[m], 0, t0], [X[m + 1], 0, t1], '#13232f', 2.2, true);
        seg(items, B, [X[m], 0, f[idx[m]] * zs], [X[m + 1], 0, f[idx[m + 1]] * zs], 'rgba(90,100,110,.55)', 1, true);
        if (opt.env && (m & 1) === 0) {
          seg(items, B, [X[m], 0, (A.max[idx[m]] + z[idx[m]]) * zs], [X[m + 1], 0, (A.max[idx[m + 1]] + z[idx[m + 1]]) * zs], 'rgba(200,69,45,.85)', 1.2, true);
          seg(items, B, [X[m], 0, (A.min[idx[m]] + z[idx[m]]) * zs], [X[m + 1], 0, (A.min[idx[m + 1]] + z[idx[m + 1]]) * zs], 'rgba(31,111,168,.85)', 1.2, true);
        }
        if ((m & 1) === 0) seg(items, B, [X[m], 0, VAPz[m]], [X[m + 1], 0, VAPz[m + 1]], 'rgba(208,100,20,.9)', 1.5, true);
      }
    }
    // valve
    const zv = ZC[M], vx0 = 98.6, vx1 = 102, tau = MOC.tau(n * S.dt, p.Tc, p.law), rb = rp * 1.55;
    for (let j = 0; j < K; j++) {
      const a1 = j / K * TAU, a2 = (j + 1) / K * TAU, s = 0.55 + 0.45 * clamp(-0.45 * Math.cos(a1 + 0.2) + 0.85 * Math.sin(a1 + 0.2), 0, 1);
      poly(items, B, [[vx0, rb * Math.cos(a1), zv + rb * Math.sin(a1)], [vx1, rb * Math.cos(a1), zv + rb * Math.sin(a1)], [vx1, rb * Math.cos(a2), zv + rb * Math.sin(a2)], [vx0, rb * Math.cos(a2), zv + rb * Math.sin(a2)]], rgba([88, 98, 108], s, 0.62));
      poly(items, B, [[vx1, 0, zv], [vx1, rb * Math.cos(a1), zv + rb * Math.sin(a1)], [vx1, rb * Math.cos(a2), zv + rb * Math.sin(a2)]], 'rgba(70,78,88,.55)');
      poly(items, B, [[102, rp * Math.cos(a1), zv + rp * Math.sin(a1)], [112, rp * Math.cos(a1), zv + rp * Math.sin(a1)], [112, rp * Math.cos(a2), zv + rp * Math.sin(a2)], [102, rp * Math.cos(a2), zv + rp * Math.sin(a2)]], rgba(BASE, s, 0.75));
    }
    const gb = zv + rp * 1.25 - 2.5 * rp * (1 - tau), gx = 100.3;
    poly(items, B, [[gx, -rp * 1.25, gb], [gx, rp * 1.25, gb], [gx, rp * 1.25, gb + 2.5 * rp], [gx, -rp * 1.25, gb + 2.5 * rp]], 'rgba(214,92,60,.92)', 'rgb(120,40,24)', 1);
    seg(items, B, [gx, 0, gb + 2.5 * rp], [gx, 0, zv + rp * 4.4 + 2.5 * rp * tau * 0], '#2b3a44', 3, true);
    seg(items, B, [gx, -2.2, zv + rp * 4.4], [gx, 2.2, zv + rp * 4.4], '#2b3a44', 4, true);
    // surge tank
    if (S.tank) {
      const T = S.tank, xt = T.x / p.L * 100, rt = clamp(2.2 + 0.5 * p.tD, 3, 7), zb = z[T.k] * zs + rp, zt = Math.max(T.top * zs, zb + 1), zl = clamp(T.Z[n] * zs, zb, zt), KT = 16;
      const full = T.spill >= 0 && n >= T.spill && T.Z[n] >= T.top - 1e-9, dry = T.empty >= 0 && n >= T.empty && T.Z[n] <= T.zt + 1e-9;
      for (let j = 0; j < KT; j++) {
        const a1 = j / KT * TAU, a2 = (j + 1) / KT * TAU, s = 0.6 + 0.4 * clamp(-0.45 * Math.cos(a1) + 0.85 * 0.5, 0, 1), P = (a, zz) => [xt + rt * Math.cos(a), rt * Math.sin(a), zz];
        poly(items, B, [P(a1, zb), P(a2, zb), P(a2, zt), P(a1, zt)], dry ? 'rgba(200,60,40,.16)' : 'rgba(150,175,195,.16)', 'rgba(60,80,95,.35)', 0.8);
        if (zl > zb + 0.01) poly(items, B, [P(a1, zb), P(a2, zb), P(a2, zl), P(a1, zl)], rgba([80, 150, 210], s, 0.62));
      }
      if (zl > zb + 0.01) poly(items, B, Array.from({ length: KT }, (_, j) => [xt + rt * Math.cos(j / KT * TAU), rt * Math.sin(j / KT * TAU), zl]), 'rgba(95,165,225,.8)');
      for (let j = 0; j < KT; j++) seg(items, B, [xt + rt * Math.cos(j / KT * TAU), rt * Math.sin(j / KT * TAU), zt], [xt + rt * Math.cos((j + 1) / KT * TAU), rt * Math.sin((j + 1) / KT * TAU), zt], full ? '#a3281a' : '#2b3a44', 2, true);
    }
    // particles
    if (opt.flow && S.Qf) for (const q of flow) {
      const i = Math.round(clamp(q.s, 0, 1) * N), rr = R[Math.min(M, Math.round(q.s * M))] * 0.92 * q.r;
      if (rup && Math.abs(i - A.burst.i) < 3) continue;
      dot(items, B, q.s * 100, rr * Math.cos(q.a), z[i] * zs + rr * Math.sin(q.a), 0.3, 'rgba(255,255,255,.92)');
    }
    for (const q of spray) dot(items, B, q.x, q.y, q.z, 0.5, `rgba(${q.c ? '120,190,240' : '150,205,245'},${clamp(1 - q.life / q.max, 0, 1) * 0.95})`);
    ctx.fillStyle = '#e8eef1'; ctx.fillRect(0, 0, w, h);
    flush(ctx, ground); flush(ctx, items); stats.items = items.length + ground.length;
    // labels and HUD
    ctx.font = '12px "Segoe UI",system-ui,sans-serif';
    label(ctx, B, -17, 0, zw + 3, 'Reservoir (' + p.Hres.toFixed(0) + ' m)'); label(ctx, B, 101, 0, zv + rp * 6.2, 'Valve');
    if (S.tank) { const T = S.tank; label(ctx, B, T.x / p.L * 100, 0, Math.max(T.top * zs, z[T.k] * zs + 3) + 3, 'Surge tank'); }
    if (rup) label(ctx, B, X[mb], 0, ZC[mb] + 15, 'BURST', '#a3281a');
    ctx.fillStyle = '#5b6b76'; ctx.fillText(`Schematic scale (pipe diameter exaggerated, vertical x${opt.vex}). Drag: rotate, wheel: zoom, shift+drag: pan, double-click: reset.`, 10, h - 8);
  }

  /* ---------------- pressure surface ---------------- */
  let off = null, key = '';
  function drawSurface(ctx, w, h, c, dpr) {
    const S = c.S, A = c.A, p = S.p, W = S.W, F = S.field, z = S.z, nx = Math.min(W, 80), nt = Math.min(A.end + 1, 110), tEnd = Math.max(A.end, 1);
    const k = [w, h, dpr, cam.yaw.toFixed(3), cam.pitch.toFixed(3), cam.dist.toFixed(1), cam.tx.toFixed(1), cam.ty.toFixed(1), cam.tz.toFixed(1), S.stamp, A.end].join('|');
    const colI = (cI) => Math.round(cI * (W - 1) / (nx - 1)), rowN = (r) => nt === 1 ? 0 : Math.round(r * A.end / (nt - 1));
    let Pmin = Infinity, Pmax = -Infinity;
    for (let r = 0; r < nt; r++) for (let q = 0; q < nx; q++) { const i = colI(q), P = F[rowN(r) * W + i] - z[i]; if (P < Pmin) Pmin = P; if (P > Pmax) Pmax = P; }
    const Pb = Math.min(0, Pmin), sz = 34 / Math.max(Pmax - Pb, 1e-6), HZ = (P) => (P - Pb) * sz, XX = (i) => i / (W - 1) * 100, YY = (nn) => nn / tEnd * 70;
    if (key !== k) {
      key = k; off = off || document.createElement('canvas'); off.width = w * dpr; off.height = h * dpr;
      const o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0); o.fillStyle = '#e8eef1'; o.fillRect(0, 0, w, h);
      const B = basis(w, h), items = [];
      poly(items, B, [[0, 0, 0], [100, 0, 0], [100, 70, 0], [0, 70, 0]], 'rgba(200,210,216,.6)', 'rgba(90,100,110,.6)', 1);
      for (let r = 0; r < nt - 1; r++) for (let q = 0; q < nx - 1; q++) {
        const i0 = colI(q), i1 = colI(q + 1), n0 = rowN(r), n1 = rowN(r + 1), V = (i, nn) => F[nn * W + i] - z[i];
        const P00 = V(i0, n0), P10 = V(i1, n0), P11 = V(i1, n1), P01 = V(i0, n1);
        const pts = [[XX(i0), YY(n0), HZ(P00)], [XX(i1), YY(n0), HZ(P10)], [XX(i1), YY(n1), HZ(P11)], [XX(i0), YY(n1), HZ(P01)]];
        const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2], bx = pts[3][0] - pts[0][0], by = pts[3][1] - pts[0][1], bz = pts[3][2] - pts[0][2];
        let nx_ = ay * bz - az * by, ny_ = az * bx - ax * bz, nz_ = ax * by - ay * bx; const nl = Math.hypot(nx_, ny_, nz_) || 1;
        const sh = 0.6 + 0.4 * clamp((-0.3 * nx_ - 0.4 * ny_ + 0.85 * nz_) / nl, 0, 1), u = ((P00 + P11) / 2 - ((F[i0] - z[i0]) + (F[i1] - z[i1])) / 2) / A.rng;
        const fc = rgba(ramp(u), sh, 1); poly(items, B, pts, fc, fc, 0.8);
      }
      const plane = (P, fill, stroke) => { if (P < Pb || P > Pmax) return; const hh = HZ(P); poly(items, B, [[0, 0, hh], [100, 0, hh], [100, 70, hh], [0, 70, hh]], fill, stroke, 1.2); };
      plane(0, 'rgba(120,130,140,.10)', 'rgba(90,100,110,.5)'); plane(MOC.VAP(p.rho), 'rgba(230,130,30,.14)', 'rgba(208,100,20,.9)'); plane(A.Hb, 'rgba(200,50,30,.12)', 'rgba(163,40,26,.9)');
      const pre = [], bar0 = (P) => p.rho * 9.81 * P / 1e5, bs = niceStep((bar0(Pmax) - bar0(Pb)) / 4);   // back walls with a pressure grid (drawn first, behind the surface)
      poly(pre, B, [[0, 70, 0], [100, 70, 0], [100, 70, 36], [0, 70, 36]], 'rgba(214,222,228,.6)'); poly(pre, B, [[100, 0, 0], [100, 70, 0], [100, 70, 36], [100, 0, 36]], 'rgba(214,222,228,.5)');
      for (let vb = Math.ceil(bar0(Pb) / bs) * bs; vb <= bar0(Pmax); vb += bs) { const hh = HZ(vb * 1e5 / (p.rho * 9.81)); seg(pre, B, [0, 70, hh], [100, 70, hh], 'rgba(90,100,110,.4)', 1); seg(pre, B, [100, 0, hh], [100, 70, hh], 'rgba(90,100,110,.4)', 1); }
      flush(o, pre); flush(o, items);
      o.font = '11px "Segoe UI",system-ui,sans-serif'; const bar = (P) => p.rho * 9.81 * P / 1e5;
      const nice = (r) => { const e = Math.pow(10, Math.floor(Math.log10(r))), q = r / e; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * e; };
      const sx = nice(p.L / 4); for (let v = 0; v <= p.L + 1e-6; v += sx) label(o, B, v / p.L * 100, -5, 0, String(Math.round(v)));
      const tstep = nice(tEnd * S.dt / 4); for (let v = 0; v <= tEnd * S.dt + 1e-9; v += tstep) label(o, B, 106, v / (tEnd * S.dt) * 70, 0, v.toFixed(v < 1 ? 2 : 1));
      const bstep = nice((bar(Pmax) - bar(Pb)) / 4); for (let v = Math.ceil(bar(Pb) / bstep) * bstep; v <= bar(Pmax); v += bstep) { const Pm = v * 1e5 / (p.rho * 9.81); label(o, B, -6, 0, HZ(Pm), v.toFixed(1)); }
      o.fillStyle = '#13232f'; label(o, B, 50, -12, 0, 'distance from reservoir (m)'); label(o, B, 116, 35, 0, 'time (s)'); label(o, B, -14, 0, 42, 'pressure (bar gauge)');
      if (Pb < 0 || true) { label(o, B, 104, 0, HZ(MOC.VAP(p.rho)) + 1, MOC.VAP(p.rho) >= Pb ? 'vapor pressure' : '', '#c26a10'); }
      stats.items = items.length;
    }
    ctx.drawImage(off, 0, 0, w, h);
    const B = basis(w, h), nn = Math.min(A.end, c.n), Yc = YY(nn), pts = [];
    for (let q = 0; q < nx; q++) { const i = colI(q); pts.push([XX(i), Yc, HZ(F[nn * W + i] - z[i])]); }
    const flat = []; for (const pt of pts) flat.push(PR(B, pt[0], pt[1], pt[2]));
    ctx.beginPath(); flat.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
    for (let i = pts.length - 1; i >= 0; i--) { const q = PR(B, pts[i][0], pts[i][1], 0); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.fillStyle = 'rgba(19,35,47,.18)'; ctx.fill();
    ctx.strokeStyle = '#13232f'; ctx.lineWidth = 2.4; ctx.beginPath(); flat.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
    if (A.burst) { const q = PR(B, 50, YY(A.end), 0); ctx.fillStyle = '#a3281a'; ctx.font = '600 12px "Segoe UI",system-ui,sans-serif'; ctx.fillText('burst at t = ' + A.burst.t.toFixed(3) + ' s', q[0] + 6, q[1] + 14); }
    ctx.font = '12px "Segoe UI",system-ui,sans-serif'; ctx.fillStyle = '#5b6b76';
    ctx.fillText('Pressure over distance and time; colour = change from steady state; dark line = now; orange plane = vapor pressure, red = yield.', 10, h - 8);
  }

  /* ---------------- camera, interaction ---------------- */
  const PRESETS = { iso: { yaw: -0.62, pitch: 0.42 }, side: { yaw: 0, pitch: 0.06 }, top: { yaw: 0, pitch: 1.5 }, valve: { yaw: 1.9, pitch: 0.25 } };
  function preset(name) { const q = PRESETS[name]; if (!q) return; Object.assign(cam, q); if (name === 'valve') cam.tx = 78; else cam.tx = mode === 'scene' ? 40 : 50; }
  function setMode(m) { mode = m; cam = m === 'surface' ? camSurf : camScene; }
  function fit(S) {
    const { zs } = scale(S), top = Math.max(S.p.Hres * zs, S.tank ? S.tank.top * zs : 0);
    camScene.tz = clamp(top * 0.3, 6, 60); camScene.dist = camScene.d0 = clamp(125 + top * 1.0, 138, 420); camScene.tx = 40;
  }
  function attach(cv, onChange) {
    const pts = new Map(); let lastPinch = 0;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragging = true; });
    const up = (e) => { pts.delete(e.pointerId); if (!pts.size) dragging = false; lastPinch = 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointermove', (e) => {
      const q = pts.get(e.pointerId); if (!q) return;
      if (pts.size === 2) { const a = [...pts.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (lastPinch) cam.dist = clamp(cam.dist * lastPinch / d, 30, 600); lastPinch = d; q.x = e.clientX; q.y = e.clientY; onChange(); return; }
      const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY;
      if (e.shiftKey || e.buttons === 2) { const s = cam.dist * 0.0016; cam.tx -= (Math.cos(cam.yaw) * dx) * s; cam.ty -= (Math.sin(cam.yaw) * dx) * s; cam.tz = clamp(cam.tz + dy * s, -40, 150); }
      else { cam.yaw -= dx * 0.008; cam.pitch = clamp(cam.pitch + dy * 0.006, -0.15, 1.55); }
      onChange();
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 30, 600); onChange(); }, { passive: false });
    cv.addEventListener('dblclick', () => { Object.assign(cam, mode === 'surface' ? { yaw: -0.55, pitch: 0.52, dist: 178, tx: 50, ty: 35, tz: 6 } : { yaw: -0.62, pitch: 0.42, dist: camScene.d0, tx: 40, ty: 0 }); onChange(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  root.V3 = { opt, draw: (ctx, w, h, c, dpr) => mode === 'surface' ? drawSurface(ctx, w, h, c, dpr || 1) : drawScene(ctx, w, h, c), update, attach, preset, setMode, fit, stats, get cam() { return cam; }, get mode() { return mode; }, spray, flow };
})(this);

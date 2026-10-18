/* Method-of-Characteristics water hammer solver (port of python/moc.py). SI units. */
(function (root) {
  const g = 9.81;
  const DEF = { L: 1000, D: 0.3, e: 0.008, E: 200e9, K: 2.2e9, rho: 998, nu: 0.3, support: 'anchored',
                f: 0.02, V0: 1, Hres: 100, Tc: 0, law: 'linear', T: 15, N: 100, sy: 240, fosreq: 2,
                tank: false, tx: 500, tD: 3, tH: 150, tDo: 0.2,
                z0: 0, zm: 0, pm: 50 };  // elevation (m above the valve): pipe inlet, mid knot, mid-knot position (% of L)
  const VAP = (rho) => -(101325 - 2340) / (rho * 9.81);  // vapor pressure head, gauge (m)  // surge tank: location (m), diameter (m), top above pipe axis (m), orifice dia (m)
  function waveSpeed(p) {
    const c1 = p.support === 'free' ? 1 - p.nu / 2 : p.support === 'joints' ? 1 : 1 - p.nu * p.nu;
    return Math.sqrt((p.K / p.rho) / (1 + (p.K / p.E) * (p.D / p.e) * c1));
  }
  function tau(t, Tc, law) {
    if (law === 'none') return 1;
    if (t >= Tc) return 0;
    const s = t / Tc;
    if (law === 'two') return s < 0.3 ? 1 - 0.8 * s / 0.3 : 0.2 * (1 - (s - 0.3) / 0.7);
    return 1 - s;
  }
  function simulate(q) {
    const p = Object.assign({}, DEF, q), a = waveSpeed(p), N = p.N, dx = p.L / N, dt = dx / a;
    const A = Math.PI * p.D * p.D / 4, B = a / (g * A), R = p.f * dx / (2 * g * p.D * A * A), Q0 = p.V0 * A;
    let H = new Float64Array(N + 1), Q = new Float64Array(N + 1).fill(Q0), Hn = new Float64Array(N + 1), Qn = new Float64Array(N + 1);
    const xm = p.L * Math.min(Math.max(p.pm, 1), 99) / 100, z = new Float64Array(N + 1);   // pipe axis elevation, valve = datum
    for (let i = 0; i <= N; i++) { const xi = i * dx; z[i] = xi <= xm ? p.z0 + (p.zm - p.z0) * xi / xm : p.zm - p.zm * (xi - xm) / (p.L - xm); }
    z[N] = 0;
    for (let i = 0; i <= N; i++) H[i] = p.Hres - p.f * (i * dx) / p.D * p.V0 * p.V0 / (2 * g);
    if (H[N] <= 0) {
      const hf = p.Hres - H[N], vmax = p.f > 0 ? Math.sqrt(2 * g * p.Hres * p.D / (p.f * p.L)) : Infinity;
      throw new Error(`Friction loss along the pipe (${hf.toFixed(1)} m of head) is at least the reservoir head (${p.Hres} m), so no flow can reach the valve. Lower the velocity to under ${vmax.toFixed(2)} m/s, raise the reservoir head above ${Math.ceil(hf)} m, or shorten the pipe, widen it, or lower the friction factor.`);
    }
    for (let i = 0; i <= N; i++) if (H[i] - z[i] <= VAP(p.rho)) throw new Error(`The pipe crest near ${(i * dx).toFixed(0)} m is above the hydraulic grade line even in steady flow, so the pipe would not run full. Lower the crest elevation or raise the reservoir level.`);
    const k = Q0 / Math.sqrt(H[N] - z[N]), steps = Math.round(p.T / dt), W = N + 1;
    if ((steps + 1) * W > 1.2e7) throw new Error('Too many grid points: reduce simulated time or reaches.');
    const field = new Float64Array((steps + 1) * W), Hv = new Float64Array(steps + 1), Hm = new Float64Array(steps + 1), Qv = new Float64Array(steps + 1);
    const Qf = q.keepQ === false ? null : new Float32Array((steps + 1) * W);   // flow field, used by the 3D particles
    // Open surge tank at interior node kt: orifice loss K*q|q| (Cd = 0.8), level from a trapezoidal volume balance.
    const tk = !!p.tank; let zt = 0, top = 0, kt = 0, At = 1, K = 0, Z = 0, Qt = 0, Qup = Q0, Qdn = Q0, Zs = null, Qts = null, Hks = null, spill = -1, empty = -1, vol = 0;
    if (tk) {
      kt = Math.min(Math.max(Math.round(p.tx / dx), 1), N - 1); const Ao = Math.PI * p.tDo * p.tDo / 4; At = Math.PI * p.tD * p.tD / 4;
      K = 1 / (2 * g * Math.pow(0.8 * Ao, 2)); Z = H[kt]; zt = z[kt]; top = zt + p.tH;
      if (Z > top) throw new Error(`Tank height must exceed the steady head at its location (${Z.toFixed(1)} m above the pipe). Raise the tank or move it.`);
      Zs = new Float64Array(steps + 1); Qts = new Float64Array(steps + 1); Hks = new Float64Array(steps + 1);
    }
    const sol = (b1, c1) => -2 * c1 / (b1 + Math.sqrt(b1 * b1 + 4 * K * Math.abs(c1)));
    const rec = (n) => { for (let i = 0; i < W; i++) field[n * W + i] = H[i]; Hv[n] = H[N]; Hm[n] = H[N >> 1]; Qv[n] = Q[N]; if (Qf) for (let i = 0; i < W; i++) Qf[n * W + i] = Q[i]; if (tk) { Zs[n] = Z; Qts[n] = Qt; Hks[n] = H[kt]; } };
    rec(0);
    for (let n = 1; n <= steps; n++) {
      for (let i = 1; i < N; i++) {
        const qd = (tk && i === kt - 1) ? Qup : Q[i + 1];   // node kt-1 sees the upstream-side flow of the tank node
        const cp = H[i - 1] + B * Q[i - 1] - R * Q[i - 1] * Math.abs(Q[i - 1]);
        const cm = H[i + 1] - B * qd + R * qd * Math.abs(qd);
        Hn[i] = (cp + cm) / 2; Qn[i] = (cp - cm) / (2 * B);
      }
      const q1 = (tk && kt === 1) ? Qup : Q[1], cm0 = H[1] - B * q1 + R * q1 * Math.abs(q1);
      Hn[0] = p.Hres; Qn[0] = (p.Hres - cm0) / B;
      const cpN = H[N - 1] + B * Q[N - 1] - R * Q[N - 1] * Math.abs(Q[N - 1]);
      const cv = cpN - z[N], c = Math.pow(tau(n * dt, p.Tc, p.law) * k, 2), d = B * B * c * c + 4 * c * cv;   // valve orifice sees pressure head H - z
      Qn[N] = (c > 0 && cv > 0 && d > 0) ? (-B * c + Math.sqrt(d)) / 2 : 0;
      Hn[N] = cpN - B * Qn[N];
      if (tk) {
        const CP = H[kt - 1] + B * Q[kt - 1] - R * Q[kt - 1] * Math.abs(Q[kt - 1]), CM = H[kt + 1] - B * Q[kt + 1] + R * Q[kt + 1] * Math.abs(Q[kt + 1]), s = (CP + CM) / 2;
        let q = sol(B / 2 + dt / (2 * At), Z + dt * Qt / (2 * At) - s), Zn = Z + dt * (Qt + q) / (2 * At);
        if (Zn > top) {                                    // full: surplus spills over the rim
          const q2 = sol(B / 2, top - s);
          if (q2 > 0) { Zn = top; q = q2; vol += q * dt; if (spill < 0) spill = n; } else Zn = top;
        } else if (Zn < zt) { Zn = zt; q = 0; if (empty < 0) empty = n; }   // empty: tank cannot supply water
        const Hk = s - B * q / 2; Qup = (CP - Hk) / B; Qdn = (Hk - CM) / B; Hn[kt] = Hk; Qn[kt] = Qdn; Z = Zn; Qt = q;
      }
      let t = H; H = Hn; Hn = t; t = Q; Q = Qn; Qn = t;
      rec(n);
    }
    return { p, a, dt, dx, steps, W, field, Qf, z, Hv, Hm, Qv, Q0, A, tArr: (n) => n * dt,
             tank: tk ? { k: kt, x: kt * dx, zt, top, Z: Zs, Qt: Qts, Hk: Hks, spill, empty, vol, At, K } : null };
  }
  // Hoop stress (MPa): thin wall on mean diameter, gauge head H (m).
  function sigma(H, p) { return p.rho * g * H * (p.D + p.e) / (2 * p.e) / 1e6; }
  const fosOf = (peak, p) => { const s = sigma(peak, p); return s > 0 ? p.sy / s : Infinity; };
  // Scans pressure head P = H - z over all nodes and steps; stops at the first step where hoop stress reaches yield (burst).
  function analyze(S) {
    const p = S.p, W = S.W, F = S.field, z = S.z, Hb = p.sy * 1e6 * 2 * p.e / (p.rho * g * (p.D + p.e));
    const max = new Float64Array(W).fill(-Infinity), min = new Float64Array(W).fill(Infinity);
    let end = S.steps, node = -1, peak = -Infinity, pkN = 0, pkS = 0, minP = Infinity, mnN = 0, mnS = 0, rng = 1e-9, steady = -Infinity;
    for (let i = 0; i < W; i++) steady = Math.max(steady, F[i] - z[i]);
    for (let n = 0; n <= S.steps; n++) {
      let sm = -Infinity, sa = 0;
      for (let i = 0; i < W; i++) {
        const P = F[n * W + i] - z[i]; if (P > max[i]) max[i] = P; if (P < min[i]) min[i] = P;
        if (P > sm) { sm = P; sa = i; } if (P < minP) { minP = P; mnN = i; mnS = n; }
        const d = Math.abs(F[n * W + i] - F[i]); if (d > rng) rng = d;
      }
      if (sm > peak) { peak = sm; pkN = sa; pkS = n; }
      if (sm >= Hb) { end = n; node = sa; break; }
    }
    return { Hb, end, burst: node >= 0 ? { i: node, n: end, x: p.L * node / (W - 1), t: end * S.dt } : null,
             peak, fos: fosOf(peak, p), max, min, rng, steady, peakNode: pkN, peakStep: pkS, minP, minNode: mnN, minStep: mnS };
  }
  // Smallest wall (rounded up to 0.1 mm) with FoS >= fosreq at the transient peak; null if unreachable.
  function requiredThickness(q) {
    const p = Object.assign({}, DEF, q);
    const fos = (e, N) => { const s = simulate(Object.assign({}, p, { e, N, keepQ: false })); let m = -Infinity; const W = s.W;
      for (let n = 0; n <= s.steps; n++) for (let i = 0; i < W; i++) { const v = s.field[n * W + i] - s.z[i]; if (v > m) m = v; }
      return fosOf(m, Object.assign({}, p, { e })); };
    const Ns = Math.min(p.N, 100); let lo = 2e-4, hi = p.D;
    if (fos(hi, Ns) < p.fosreq) return null;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (fos(mid, Ns) >= p.fosreq) hi = mid; else lo = mid; }
    let e = Math.ceil(hi * 1e4) / 1e4;
    for (let k = 0; k < 100 && fos(e, p.N) < p.fosreq; k++) e += 1e-4;
    return e;
  }
  const api = { simulate, waveSpeed, tau, g, DEF, VAP, sigma, analyze, requiredThickness };
  if (typeof module !== 'undefined') module.exports = api; else root.MOC = api;
})(this);

const { simulate, analyze, requiredThickness } = require('./moc.js'), ref = require('../python/ref_case.json');
const bad = (m) => { console.error('FAIL', m); process.exit(1); };
const r = simulate(Object.assign({}, ref.p)); let m1 = 0, m2 = 0;
if (r.Hv.length !== ref.Hv.length) bad('length mismatch');
for (let i = 0; i < ref.Hv.length; i++) { m1 = Math.max(m1, Math.abs(r.Hv[i] - ref.Hv[i])); m2 = Math.max(m2, Math.abs(r.Hm[i] - ref.Hm[i])); }
console.log('max |JS - Python| valve:', m1.toExponential(2), ' midpoint:', m2.toExponential(2));
if (m1 > 1e-8 || m2 > 1e-8) bad('time history');
const A = analyze(simulate(ref.burst.p));
if (!A.burst || A.end !== ref.burst.end || A.burst.i !== ref.burst.node || Math.abs(A.fos - ref.burst.fos) > 1e-9) bad('burst/FoS');
console.log('burst step', A.end, 'node', A.burst.i, 'FoS', A.fos.toFixed(3));
const e = requiredThickness(ref.thick.p); if (Math.abs(e - ref.thick.e) > 1e-12) bad('required thickness ' + e + ' vs ' + ref.thick.e);
console.log('required wall', (e * 1e3).toFixed(1), 'mm');
const tc = ref.tank, rt = simulate(tc.p); let d1 = 0, d2 = 0, d3 = 0;
for (let i = 0; i < tc.Hv.length; i++) { d1 = Math.max(d1, Math.abs(rt.Hv[i] - tc.Hv[i])); d2 = Math.max(d2, Math.abs(rt.tank.Hk[i] - tc.Hk[i])); d3 = Math.max(d3, Math.abs(rt.tank.Z[i] - tc.Z[i])); }
console.log('surge tank max |JS - Python| valve:', d1.toExponential(2), ' tank node:', d2.toExponential(2), ' level:', d3.toExponential(2));
if (d1 > 1e-8 || d2 > 1e-8 || d3 > 1e-8) bad('surge tank');
const sl = ref.slope, rs = simulate(sl.p), As = analyze(rs); let d4 = 0, d5 = 0;
for (let i = 0; i < sl.Hv.length; i++) { d4 = Math.max(d4, Math.abs(rs.Hv[i] - sl.Hv[i])); d5 = Math.max(d5, Math.abs(rs.tank.Z[i] - sl.Z[i])); }
const an = sl.an, cmp = (k, v) => { if (Math.abs(v - an[k]) > 1e-8) bad('slope analysis ' + k + ' ' + v + ' vs ' + an[k]); };
cmp('peak', As.peak); cmp('fos', As.fos); cmp('minP', As.minP); cmp('steady', As.steady); cmp('Hb', As.Hb);
if (As.end !== an.end || As.minNode !== an.minNode || As.minStep !== an.minStep) bad('slope analysis indices');
if (Math.abs(rs.tank.zt - sl.zt) > 1e-9 || d4 > 1e-8 || d5 > 1e-8) bad('slope case');
console.log('slope + tank: max |JS - Python| valve', d4.toExponential(2), 'level', d5.toExponential(2), '| min pressure', As.minP.toFixed(2), 'm at node', As.minNode);
console.log('PASS JS matches Python reference');

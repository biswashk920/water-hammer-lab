"""Reference Method-of-Characteristics water hammer solver + validation suite.
Reservoir (upstream) - pipe - valve discharging to atmosphere (downstream). SI units."""
import numpy as np, json
g = 9.81
DEF = dict(L=1000., D=0.3, e=0.008, E=200e9, K=2.2e9, rho=998., nu=0.3, support='anchored',
           f=0.02, V0=1.0, Hres=100., Tc=0.0, law='linear', T=15., N=100, sy=240., fosreq=2.0,
           tank=False, tx=500., tD=3., tH=150., tDo=0.2,
           z0=0., zm=0., pm=50.)  # elevation (m above valve): pipe inlet, mid knot, mid-knot position (% of L)
#  # surge tank: location (m), diameter (m), top above pipe axis (m), orifice dia (m)

def wave_speed(p):
    c1 = {'free': 1 - p['nu']/2, 'joints': 1.0}.get(p['support'], 1 - p['nu']**2)
    return np.sqrt((p['K']/p['rho'])/(1 + (p['K']/p['E'])*(p['D']/p['e'])*c1))

def tau(t, Tc, law):
    if law == 'none': return 1.0
    if t >= Tc: return 0.0
    s = t/Tc
    if law == 'two': return 1-0.8*s/0.3 if s < 0.3 else 0.2*(1-(s-0.3)/0.7)
    return 1-s

def simulate(p):
    p = {**DEF, **p}; a = wave_speed(p); N = p['N']; dx = p['L']/N; dt = dx/a
    A = np.pi*p['D']**2/4; B = a/(g*A); R = p['f']*dx/(2*g*p['D']*A*A)
    Q0 = p['V0']*A; x = np.arange(N+1)*dx
    xm = p['L']*min(max(p['pm'], 1.), 99.)/100; z = np.interp(x, [0, xm, p['L']], [p['z0'], p['zm'], 0.])  # pipe axis elevation, valve = datum
    H = p['Hres'] - p['f']*x/p['D']*p['V0']**2/(2*g); Q = np.full(N+1, Q0)
    if H[-1] <= 0: raise ValueError('Steady head at valve <= 0: reduce V0 or friction')
    if (H - z).min() <= -(101325-2340)/(p['rho']*g): raise ValueError('Pipe crest is above the hydraulic grade line')
    k = Q0/np.sqrt(H[-1] - z[-1]); steps = int(round(p['T']/dt)); Hf = np.empty((steps+1, N+1)); Hf[0] = H
    Qv = np.empty(steps+1); Qv[0] = Q0
    tk = p['tank']; T = None
    if tk:  # open surge tank at interior node kt; orifice loss K*q|q| (Cd = 0.8); level from trapezoidal volume balance
        kt = min(max(int(round(p['tx']/dx)), 1), N-1); At = np.pi*p['tD']**2/4; Ao = np.pi*p['tDo']**2/4
        K = 1/(2*g*(0.8*Ao)**2); Z = H[kt]; zt = z[kt]; Hmax = zt + p['tH']; Qt = 0.; Qup = Qdn = Q0
        if Z > Hmax: raise ValueError('Tank height must exceed the steady head at its location')
        T = dict(k=kt, Z=np.empty(steps+1), Qt=np.empty(steps+1), Qup=np.empty(steps+1), Qdn=np.empty(steps+1), spill=-1, empty=-1, vol=0., K=K, zt=zt)
        T['Z'][0] = Z; T['Qt'][0] = 0.; T['Qup'][0] = T['Qdn'][0] = Q0
        sol = lambda b1, c1: -2*c1/(b1 + np.sqrt(b1*b1 + 4*K*abs(c1)))
    for n in range(1, steps+1):
        cp = H[:-1] + B*Q[:-1] - R*Q[:-1]*np.abs(Q[:-1])   # C+ from node i-1
        cm = H[1:] - B*Q[1:] + R*Q[1:]*np.abs(Q[1:])       # C- from node i+1
        if tk: cm[kt-1] = H[kt] - B*Qup + R*Qup*abs(Qup)   # node kt-1 sees the upstream-side flow of the tank node
        Hn = np.empty(N+1); Qn = np.empty(N+1)
        Hn[1:N] = (cp[:-1] + cm[1:])/2; Qn[1:N] = (cp[:-1] - cm[1:])/(2*B)
        Hn[0] = p['Hres']; Qn[0] = (p['Hres'] - cm[0])/B
        c = (tau(n*dt, p['Tc'], p['law'])*k)**2; cpN = cp[-1]; cv = cpN - z[N]; d = B*B*c*c + 4*c*cv   # valve orifice sees pressure head H - z
        Qn[N] = (-B*c + np.sqrt(d))/2 if (c > 0 and cv > 0 and d > 0) else 0.0
        Hn[N] = cpN - B*Qn[N]
        if tk:
            CP = cp[kt-1]; CM = cm[kt]; s_ = (CP+CM)/2
            q = sol(B/2 + dt/(2*At), Z + dt*Qt/(2*At) - s_); Zn = Z + dt*(Qt+q)/(2*At)
            if Zn > Hmax:                                  # full: surplus spills over the rim
                q2 = sol(B/2, Hmax - s_)
                if q2 > 0:
                    Zn, q = Hmax, q2; T['vol'] += q*dt
                    if T['spill'] < 0: T['spill'] = n
                else: Zn = Hmax
            elif Zn < zt:                                  # empty: tank cannot supply water
                Zn, q = zt, 0.
                if T['empty'] < 0: T['empty'] = n
            Hk = s_ - B*q/2; Qup = (CP-Hk)/B; Qdn = (Hk-CM)/B; Hn[kt] = Hk; Qn[kt] = Qdn; Z, Qt = Zn, q
            T['Z'][n] = Z; T['Qt'][n] = Qt; T['Qup'][n] = Qup; T['Qdn'][n] = Qdn
        H, Q = Hn, Qn; Hf[n] = H; Qv[n] = Q[N]
    return dict(a=a, dt=dt, t=np.arange(steps+1)*dt, H=Hf, Qv=Qv, p=p, Q0=Q0, tank=T, z=z)

def sigma(H, p):  # hoop stress in MPa, thin wall on mean diameter, gauge head H (m)
    return p['rho']*g*H*(p['D']+p['e'])/(2*p['e'])/1e6

def _fos(peak, p):
    s = sigma(peak, p); return p['sy']/s if s > 0 else float('inf')

def analyze(r):
    """Scan pressure head P = H - z (all nodes, all steps) up to the first burst."""
    p = r['p']; P = r['H'] - r['z']; Hb = p['sy']*1e6*2*p['e']/(p['rho']*g*(p['D']+p['e']))
    idx = np.nonzero(P.max(axis=1) >= Hb)[0]; end = int(idx[0]) if len(idx) else P.shape[0]-1
    sub = P[:end+1]; peak = sub.max(); ms, mi = np.unravel_index(np.argmin(sub), sub.shape)
    return dict(Hb=Hb, end=end, burst=len(idx) > 0, node=int(np.argmax(P[end])) if len(idx) else None, peak=peak,
                fos=_fos(peak, p), minP=sub.min(), minStep=int(ms), minNode=int(mi), steady=P[0].max())

def required_thickness(q):
    """Smallest wall (rounded up to 0.1 mm) giving FoS >= fosreq at the transient peak. None if unreachable."""
    import math
    p = {**DEF, **q}
    def fos(e, N):
        r = simulate({**p, 'e': e, 'N': N}); return _fos((r['H'] - r['z']).max(), {**p, 'e': e})
    Ns = min(p['N'], 100); lo, hi = 2e-4, p['D']
    if fos(hi, Ns) < p['fosreq']: return None
    for _ in range(40):
        mid = (lo+hi)/2
        if fos(mid, Ns) >= p['fosreq']: hi = mid
        else: lo = mid
    e = math.ceil(hi*1e4)/1e4
    for _ in range(100):
        if fos(e, p['N']) >= p['fosreq']: break
        e += 1e-4
    return e

def run_tests():
    r = simulate(dict(law='none', T=5)); assert np.abs(r['H'] - r['H'][0]).max() < 1e-9; print('PASS steady state preserved')
    p = dict(f=0., Tc=1e-9, V0=1.0); r = simulate(p); a, L = r['a'], 1000.; dH = a/g
    Hv = r['H'][:, -1]; t = r['t']; at = lambda tt: Hv[np.argmin(abs(t-tt))]
    assert abs(Hv.max() - (100+dH)) < 1e-9*dH
    assert abs(at(L/a) - (100+dH)) < 1e-6 and abs(at(3*L/a) - (100-dH)) < 1e-6 and abs(at(5*L/a) - (100+dH)) < 1e-6
    print(f'PASS Joukowsky: a={a:.1f} m/s, dH={dH:.2f} m, square wave period 4L/a={4*L/a:.4f} s')
    Tc = 5*2*L/a; r = simulate(dict(f=0., Tc=Tc, V0=1.0)); pk = r['H'][:, -1].max()-100; mich = 2*L/(g*Tc)
    assert pk < dH and 0.5*mich < pk < 1.5*mich; print(f'PASS slow closure: MOC rise {pk:.2f} m vs Michaud {mich:.2f} m (Joukowsky {dH:.1f} m)')
    pk = [simulate(dict(Tc=2.0, N=n))['H'][:, -1].max() for n in (50, 100, 200)]
    assert abs(pk[0]-pk[2])/pk[2] < 0.02 and abs(pk[1]-pk[2])/pk[2] < 0.01; print('PASS convergence N=50/100/200 peaks:', np.round(pk, 3))
    r = simulate(dict(Tc=1e-9, V0=0.5, T=30)); Hv = r['H'][:, -1]; w = len(Hv)//8
    m = [Hv[i*w:(i+1)*w].max() for i in range(8)]; assert m[0] > m[3] > m[7]; print('PASS friction decay', np.round(m[::3], 2))
    assert abs(sigma(100., DEF) - 18.846) < 0.01; print('PASS hoop stress hand check: 100 m head -> 18.85 MPa')
    pb = {**DEF, 'f': 0., 'Tc': 1e-9, 'V0': 2., 'sy': 40., 'T': 6.}; rb = simulate(pb); ab = analyze(rb)
    brute = next(n for n in range(len(rb['H'])) if max(rb['H'][n]) >= ab['Hb'])
    assert ab['burst'] and ab['end'] == brute and ab['fos'] <= 1
    print(f"PASS burst detected at step {ab['end']} (t={ab['end']*rb['dt']:.3f} s), node {ab['node']}, FoS {ab['fos']:.2f}")
    sf = analyze(simulate({**DEF, 'Tc': 2.})); assert not sf['burst'] and sf['fos'] > 2; print(f"PASS safe case FoS {sf['fos']:.2f}")
    pt = {**DEF, 'Tc': 0.5, 'sy': 60., 'T': 10.}; e = required_thickness(pt)
    fa = lambda ee: analyze(simulate({**pt, 'e': ee}))['fos']
    assert fa(pt['e']) < 2 <= fa(e) and fa(e - 1.01e-4) < 2; print(f"PASS required wall {e*1e3:.1f} mm (FoS {fa(e):.3f}; 0.1 mm thinner fails)")
    # 8 a vanishingly small tank must reproduce the no-tank result
    b0 = dict(Tc=1.0, T=6.); d0 = simulate(b0)['H']; d1 = simulate({**b0, 'tank': True, 'tD': 1e-6, 'tH': 1e4})['H']
    assert np.abs(d0 - d1).max() < 1e-4; print('PASS tiny tank == no tank (max diff %.1e m)' % np.abs(d0 - d1).max())
    # 9 a huge tank acts as a second reservoir: valve square wave has period 4(L-x)/a
    rr = simulate(dict(f=0., Tc=1e-9, tank=True, tx=600., tD=1e4, tH=1e5, tDo=50., T=8.)); Ld = 400.; a2 = rr['a']
    Hv = rr['H'][:, -1]; t = rr['t']; at2 = lambda tt: Hv[np.argmin(abs(t-tt))]
    assert abs(at2(Ld/a2) - (100+a2/g)) < 1e-3 and abs(at2(3*Ld/a2) - (100-a2/g)) < 1e-3 and abs(at2(5*Ld/a2) - (100+a2/g)) < 1e-3
    print(f'PASS huge tank = reservoir: valve period 4(L-x)/a = {4*Ld/a2:.4f} s')
    # 10 algebra: continuity at the tank node, orifice law, and a real reduction of the valve surge
    pc = dict(Tc=2., T=20., tank=True, tx=400., tD=2., tH=200., tDo=0.15); rc = simulate(pc); Tk = rc['tank']
    assert Tk['spill'] < 0 and Tk['empty'] < 0
    assert np.abs(Tk['Qup'] - Tk['Qdn'] - Tk['Qt']).max() < 1e-9
    assert np.abs(rc['H'][:, Tk['k']] - Tk['Z'] - Tk['K']*Tk['Qt']*np.abs(Tk['Qt'])).max() < 1e-9
    nt = simulate({**pc, 'tank': False})['H'][:, -1].max(); wt = rc['H'][:, -1].max()
    assert wt < nt; print(f'PASS tank continuity and orifice law exact; valve peak {nt:.1f} m -> {wt:.1f} m with tank')
    # 11 mass oscillation: period 2*pi*sqrt(x*At/(g*A)), amplitude V0*sqrt(x*A/(g*At)) (rigid column theory)
    xt = 990.; At_ = np.pi/4; A_ = np.pi*0.3**2/4; Tth = 2*np.pi*np.sqrt(xt*At_/(g*A_)); zth = 1.0*np.sqrt(xt*A_/(g*At_))
    rm = simulate(dict(f=0., Tc=1e-9, tank=True, tx=xt, tD=1., tH=1e4, tDo=50., T=1.8*Tth)); Zs = rm['tank']['Z']
    w = int(1.0/rm['dt']); sm = np.convolve(Zs - Zs[0], np.ones(w)/w, mode='same')[w:-w]; tt = rm['t'][w:-w]
    ix = np.nonzero((sm[:-1] > 0) & (sm[1:] <= 0))[0]; per = tt[ix[1]] - tt[ix[0]]
    assert abs(per - Tth)/Tth < 0.03 and abs(sm.max() - zth)/zth < 0.05
    print(f'PASS mass oscillation: period {per:.1f} s vs {Tth:.1f} s theory, amplitude {sm.max():.2f} m vs {zth:.2f} m')
    # 12 overflow: a tank only just taller than the steady head spills, and the level is clamped at the rim
    z0 = simulate(dict(T=0.1))['H'][0, 50]; re = simulate(dict(Tc=0.5, T=20., tank=True, tx=500., tD=1., tH=z0+0.5, tDo=0.15))
    assert re['tank']['spill'] >= 0 and re['tank']['Z'].max() <= z0 + 0.5 + 1e-9; print('PASS overflow flagged and level clamped at rim')
    # 13 elevation: the piezometric-head solution does not depend on z; pressure head is H - z; crest lowers the minimum pressure
    pe = dict(Tc=2., T=10., z0=20., zm=45., pm=40.); re_ = simulate(pe); rf = simulate({**pe, 'z0': 0., 'zm': 0.})
    assert np.abs(re_['H'] - rf['H']).max() < 1e-12
    assert abs(re_['z'][0] - 20) < 1e-12 and abs(re_['z'][40] - 45) < 1e-9 and abs(re_['z'][-1]) < 1e-12
    st = simulate({**pe, 'law': 'none', 'T': 3.}); assert np.abs(st['H'] - st['H'][0]).max() < 1e-9
    ar, af = analyze(re_), analyze(rf); assert ar['minP'] < af['minP'] and ar['steady'] <= af['steady'] + 1e-9
    print(f"PASS elevation: H independent of z; min pressure head {af['minP']:.1f} m flat -> {ar['minP']:.1f} m with crest (node {ar['minNode']})")
    try: simulate(dict(zm=300.)); raise SystemExit('crest above HGL was accepted')
    except ValueError: print('PASS crest above the hydraulic grade line is rejected')
    # 14 tank on a slope: level series identical, tank bottom sits at the local pipe elevation
    pq = dict(Tc=2., T=20., tank=True, tx=400., tD=2., tH=200., tDo=0.15, z0=20., zm=30.)
    rs = simulate(pq); rq = simulate({**pq, 'z0': 0., 'zm': 0.}); assert np.abs(rs['tank']['Z'] - rq['tank']['Z']).max() < 1e-12
    assert abs(rs['tank']['zt'] - rs['z'][40]) < 1e-12 and rs['tank']['zt'] > 20; print('PASS tank on a slope: bottom at pipe elevation %.1f m' % rs['tank']['zt'])
    ra = analyze(rs); slope = dict(p=pq, Hv=rs['H'][:, -1].tolist(), Z=rs['tank']['Z'].tolist(), zt=float(rs['tank']['zt']),
        an={k: (float(v) if isinstance(v, (float, np.floating)) else v) for k, v in ra.items() if k not in ('burst', 'node')})
    r = simulate(dict(Tc=2.0, T=8, N=60))
    rt = simulate(pc)
    json.dump(dict(p=r['p'], Hv=r['H'][:, -1].tolist(), Hm=r['H'][:, 30].tolist(), a=r['a'],
                   burst=dict(p=pb, end=ab['end'], node=ab['node'], fos=float(ab['fos'])), thick=dict(p=pt, e=e), tank=dict(p=pc, Hv=rt['H'][:, -1].tolist(), Hk=rt['H'][:, rt['tank']['k']].tolist(), Z=rt['tank']['Z'].tolist()), slope=slope), open('ref_case.json', 'w'))

if __name__ == '__main__': run_tests(); print('ALL PYTHON TESTS PASSED')

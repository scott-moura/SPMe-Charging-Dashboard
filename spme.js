/*
 * spme.js — Single Particle Model with electrolyte (SPMe) + lumped thermal + aging,
 * and two charging controllers: CC-CV and a reference governor (RG).
 *
 * Sign convention: I > 0 is CHARGING current [A].
 *
 * States
 *   c_s^-(r), c_s^+(r)  solid-phase Li concentration, finite-volume shells      [mol/m^3]
 *   c_e(x)              electrolyte concentration across anode | sep | cathode  [mol/m^3]
 *   T                   lumped cell temperature                                 [K]
 *   Q_sei, Q_pl         Li inventory lost to SEI growth and to Li plating       [Ah]
 *
 * Works in the browser (window.SPMe) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPMe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const F = 96485.33212;   // C/mol
  const RG = 8.314462618;  // J/mol/K
  const TREF = 298.15;     // K

  // ---------------------------------------------------------------- parameters
  // Two cells. Source tags (full notes in the "Model and assumptions" card in index.html):
  //   [C]   Chen et al., J. Electrochem. Soc. 167 (2020) 080534, as tabulated in PyBaMM's Chen2020 set
  //   [O]   O'Kane et al., Phys. Chem. Chem. Phys. 24 (2022) 7909, as tabulated in PyBaMM's OKane2022 set
  //   [P]   PyBaMM's Prada2013 set (file Prada2013.py, PyBaMM 26.10), which attributes its values to
  //         Prada et al., J. Electrochem. Soc. 160 (2013) A616 and fills the gaps from the sources it names
  //   [P12] Prada et al., J. Electrochem. Soc. 159 (2012) A1508 (same A123 cell), Tables III and V
  //   [A]   assumption made for this tool
  const CELLS = {
    // ---- LG M50 21700, NMC811 / graphite-SiOx, 5 Ah
    nmc: {
      id: 'nmc', name: 'LG M50 21700 (NMC811 / graphite-SiOx)',
      ocpN: 'graphiteChen', ocpP: 'nmc811Chen', elyte: 'nyman',
      A: 0.1027,                 // electrode plate area, 1.58 m x 0.065 m [m^2]                 [C]
      // geometry, transport, kinetics [C]; EaDs: anode 30.3 kJ/mol (Ecker 2015), cathode 25 kJ/mol [O]
      n: { L: 85.2e-6, epsS: 0.75, epsE: 0.25, R: 5.86e-6, cmax: 33133, Ds: 3.3e-14, EaDs: 30.3e3,
           k: 6.48e-7, Eak: 35e3, sigma: 215, th0: 0.0279, th100: 0.9014 },
      p: { L: 75.6e-6, epsS: 0.665, epsE: 0.335, R: 5.22e-6, cmax: 63104, Ds: 4.0e-15, EaDs: 25e3,
           k: 3.42e-6, Eak: 17.8e3, sigma: 0.18, th100: 0.2661 },
      s: { L: 12e-6, epsE: 0.47 },
      ce0: 1000, tplus: 0.2594, brug: 1.5,                    // [C]
      brugS: 0,                  // Bruggeman exponent on the solid-phase conductivity             [C]
      EaDe: 17e3, EaKappa: 17e3,                              // [O]
      // lumped thermal
      Cth: 68,                   // heat capacity: 68 g cell x 1000 J/kg/K [J/K]                 [A]
      Asurf: 5.31e-3,            // cooling surface [m^2]                                        [C]
      h: 25,                     // convection coefficient [W/m^2/K] (slider; PyBaMM default 10) [A]
      // aging
      i0sei: 1.5e-7, Usei: 0.4, alphaSei: 0.5, EaSei: 38e3,   // SEI, reaction-limited Tafel form  [O]
      i0pl: 1.0e-2, alphaPl: 0.5,                             // plating exchange current [A/m^2], transfer coeff.  [A]
      // discretisation
      Nr: 20, Nn: 10, Ns: 3, Np: 10,
    },
    // ---- A123 ANR26650M1, LiFePO4 / graphite, 2.3 Ah
    lfp: {
      id: 'lfp', name: 'A123 ANR26650M1 (LiFePO4 / graphite)',
      ocpN: 'graphiteChen',      // [P] borrows the graphite OCP and kinetics of [C]
      ocpP: 'lfpAfshar',         // [P] LFP OCP fit attributed to Afshar et al., arXiv:1709.03970
      elyte: 'prada',            // [P] constant D_e, polynomial kappa
      A: 0.18,                   // [P], [P12]
      // geometry, D_s, c_max [P] (thicknesses, radii, eps_s, c_max, D_s,n also printed in [P12]);
      // k and Eak: graphite from [C], LFP from Kashkooli et al. 2017 [P]; EaDs from [P12] Table V
      n: { L: 34e-6, epsS: 0.58, epsE: 0.36, R: 5e-6, cmax: 30555, Ds: 3e-15, EaDs: 35e3,
           k: 6.48e-7, Eak: 35e3, sigma: 215, th0: 0.0188, th100: 0.81 },   // th0 set so the window holds 2.3 Ah
      p: { L: 80e-6, epsS: 0.374, epsE: 0.426, R: 5e-8, cmax: 22806, Ds: 5.9e-18, EaDs: 39e3,
           k: 6e-7, Eak: 39.57e3, sigma: 0.33795074, th100: 0.0038 },
      s: { L: 25e-6, epsE: 0.45 },
      ce0: 1200, tplus: 0.36, brug: 1.5,                      // [P]
      brugS: 1.5,                                             // [P]
      EaDe: 26.6e3, EaKappa: 11e3,                            // [P12] Table V
      Cth: 77,                   // 0.07 kg x 1100 J/kg/K [J/K]                                   [P12]
      Asurf: 6.34e-3,            // cell lateral surface [m^2]                                    [P12]
      h: 25,                     // slider                                                         [A]
      // aging: carried over unchanged from the other cell (graphite anode)                        [O], [A]
      i0sei: 1.5e-7, Usei: 0.4, alphaSei: 0.5, EaSei: 38e3,
      i0pl: 1.0e-2, alphaPl: 0.5,
      Nr: 20, Nn: 10, Ns: 3, Np: 10,
    },
  };
  const BASE = CELLS.nmc;

  // Open-circuit potentials
  function Un(x) {            // graphite-SiOx, Chen 2020
    return 1.9793 * Math.exp(-39.3631 * x) + 0.2482
      - 0.0909 * Math.tanh(29.8538 * (x - 0.1234))
      - 0.04478 * Math.tanh(14.9159 * (x - 0.2769))
      - 0.0205 * Math.tanh(30.4444 * (x - 0.6103));
  }
  function Up(x) {            // NMC811, Chen 2020
    return -0.8090 * x + 4.4875
      - 0.0428 * Math.tanh(18.5138 * (x - 0.5542))
      - 17.7326 * Math.tanh(15.7890 * (x - 0.3117))
      + 17.5842 * Math.tanh(15.9308 * (x - 0.3120));
  }
  function UpLFP(x) {         // LiFePO4, as coded in PyBaMM's Prada2013 set (LFP_ocp_Afshar2017)
    return 3.4077 - 0.020269 * x + 0.5 * Math.exp(-150 * x) - 0.9 * Math.exp(-30 * (1 - x));
  }
  // Electrolyte transport, LiPF6 in EC:EMC 3:7 (Nyman 2008), c in mol/m^3
  function DeNyman(c) { const y = c * 1e-3; return 8.794e-11 * y * y - 3.972e-10 * y + 4.862e-10; }
  function kappaNyman(c) { const y = c * 1e-3; return 0.1297 * y * y * y - 2.51 * Math.pow(y, 1.5) + 3.329 * y; }
  // Electrolyte of PyBaMM's Prada2013 set: constant diffusivity, quartic conductivity (c in mol/m^3)
  function DePrada() { return 2e-10; }
  function kappaPrada(c) {
    const y = c * 1e-6;
    return (4.1253e-4 + 5.007 * y - 4721.2 * y * y + 1.5094e6 * y * y * y - 1.6018e8 * y * y * y * y) * 1e3;
  }
  const OCP = { graphiteChen: Un, nmc811Chen: Up, lfpAfshar: UpLFP };
  const ELYTE = { nyman: { De: DeNyman, kappa: kappaNyman }, prada: { De: DePrada, kappa: kappaPrada } };

  function arr(Ea, T) { return Math.exp(Ea / RG * (1 / TREF - 1 / T)); }

  // makeCell(overrides, cell): cell is 'nmc' (default) or 'lfp'
  function makeCell(overrides, cell) {
    const P = JSON.parse(JSON.stringify(CELLS[cell || 'nmc']));
    if (overrides) for (const k in overrides) {
      if (overrides[k] && typeof overrides[k] === 'object' && P[k] && typeof P[k] === 'object') Object.assign(P[k], overrides[k]);
      else P[k] = overrides[k];
    }
    const n = P.n, p = P.p, s = P.s;
    P.Un = OCP[P.ocpN]; P.Up = OCP[P.ocpP]; P.De = ELYTE[P.elyte].De; P.kappa = ELYTE[P.elyte].kappa;
    n.a = 3 * n.epsS / n.R; p.a = 3 * p.epsS / p.R;        // specific area [1/m]
    n.S = n.a * n.L * P.A; p.S = p.a * p.L * P.A;          // total active surface [m^2]
    // Capacity is set by the anode stoichiometry window; cathode window follows from Li balance.
    const QnC = n.epsS * n.L * P.A * n.cmax * F * (n.th100 - n.th0);     // [C]
    P.Qcell = QnC / 3600;                                                // [Ah]
    p.th0 = p.th100 + QnC / (p.epsS * p.L * P.A * p.cmax * F);
    // solid-phase ohmic term, sigma_eff = sigma * (1 - eps_e)^brugS (PyBaMM's convention)
    P.Rsolid = (n.L / (3 * n.sigma * Math.pow(1 - n.epsE, P.brugS)) + p.L / (3 * p.sigma * Math.pow(1 - p.epsE, P.brugS))) / P.A;
    P.PhiPmax = P.Up(p.th100);        // cathode interfacial potential at 100 % SOC rest [V vs Li]
    P.hA = P.h * P.Asurf;
    P.ceFloor = 1;                  // electrolyte concentration floor [mol/m^3]

    // radial finite-volume weights (normalised by dr^3 and dr^2)
    const Nr = P.Nr;
    P.w = new Float64Array(Nr); P.a2 = new Float64Array(Nr + 1);
    for (let i = 0; i < Nr; i++) P.w[i] = ((i + 1) ** 3 - i ** 3) / 3;
    for (let i = 0; i <= Nr; i++) P.a2[i] = i * i;
    P.wsum = Nr ** 3 / 3;

    // electrolyte grid
    const Ne = P.Nn + P.Ns + P.Np; P.Ne = Ne;
    P.dx = new Float64Array(Ne); P.eps = new Float64Array(Ne); P.bg = new Float64Array(Ne);
    P.src = new Float64Array(Ne);   // volumetric Li+ source per ampere of charging current
    P.xc = new Float64Array(Ne);    // cell centres [m]
    P.fI = new Float64Array(Ne);    // fraction of I/A carried by the electrolyte at interface j+1/2
    const Ltot = n.L + s.L + p.L; P.Ltot = Ltot;
    let x = 0;
    for (let j = 0; j < Ne; j++) {
      let d, e, q;
      if (j < P.Nn) { d = n.L / P.Nn; e = n.epsE; q = -(1 - P.tplus) / (F * P.A * n.L); }
      else if (j < P.Nn + P.Ns) { d = s.L / P.Ns; e = s.epsE; q = 0; }
      else { d = p.L / P.Np; e = p.epsE; q = (1 - P.tplus) / (F * P.A * p.L); }
      P.dx[j] = d; P.eps[j] = e; P.bg[j] = Math.pow(e, P.brug); P.src[j] = q;
      P.xc[j] = x + d / 2; x += d;
      P.fI[j] = Math.min(1, x / n.L, (Ltot - x) / p.L);
    }
    // state layout
    P.iN = 0; P.iP = Nr; P.iE = 2 * Nr; P.iT = 2 * Nr + Ne; P.iQs = P.iT + 1; P.iQp = P.iT + 2;
    P.nx = P.iT + 3;
    // scratch
    P._a = new Float64Array(64); P._b = new Float64Array(64); P._c = new Float64Array(64);
    P._d = new Float64Array(64); P._g = new Float64Array(64); P._lnc = new Float64Array(64);
    P._phi = new Float64Array(64);
    return P;
  }

  function socToTheta(P, soc) {
    return {
      n: P.n.th0 + soc * (P.n.th100 - P.n.th0),
      p: P.p.th0 + soc * (P.p.th100 - P.p.th0),
    };
  }
  function ocv(P, soc) { const th = socToTheta(P, soc); return P.Up(th.p) - P.Un(th.n); }

  function initState(P, soc0, T0) {
    const x = new Float64Array(P.nx);
    const th = socToTheta(P, soc0);
    for (let i = 0; i < P.Nr; i++) { x[P.iN + i] = th.n * P.n.cmax; x[P.iP + i] = th.p * P.p.cmax; }
    for (let j = 0; j < P.Ne; j++) x[P.iE + j] = P.ce0;
    x[P.iT] = T0;
    return x;
  }

  // Thomas algorithm: sub a, diag b, super c, rhs d (all overwritten); solution in d.
  function thomas(a, b, c, d, n) {
    for (let i = 1; i < n; i++) {
      const m = a[i] / b[i - 1];
      b[i] -= m * c[i - 1];
      d[i] -= m * d[i - 1];
    }
    d[n - 1] /= b[n - 1];
    for (let i = n - 2; i >= 0; i--) d[i] = (d[i] - c[i] * d[i + 1]) / b[i];
  }

  // implicit-Euler spherical diffusion; flux j [mol/m^2/s] INTO the particle at r = R
  function stepParticle(P, x, off, D, R, j, dt) {
    const N = P.Nr, dr = R / N, mu = D * dt / (dr * dr);
    const a = P._a, b = P._b, c = P._c, d = P._d, w = P.w, a2 = P.a2;
    for (let i = 0; i < N; i++) {
      const lo = mu * a2[i], hi = i < N - 1 ? mu * a2[i + 1] : 0;
      a[i] = -lo; c[i] = -hi; b[i] = w[i] + lo + hi; d[i] = w[i] * x[off + i];
    }
    d[N - 1] += dt * j * N * N / dr;
    thomas(a, b, c, d, N);
    for (let i = 0; i < N; i++) x[off + i] = d[i];
  }

  function stepElectrolyte(P, x, I, T, dt) {
    const Ne = P.Ne, o = P.iE, a = P._a, b = P._b, c = P._c, d = P._d, g = P._g;
    const aD = arr(P.EaDe, T);
    // interface conductances with lagged D_eff
    let rPrev = 0;
    for (let j = 0; j < Ne; j++) {
      const De = P.De(Math.max(x[o + j], 1)) * aD * P.bg[j];
      const r = P.dx[j] / (2 * De);
      if (j > 0) g[j - 1] = 1 / (rPrev + r);
      rPrev = r;
    }
    for (let j = 0; j < Ne; j++) {
      const m = P.eps[j] * P.dx[j] / dt;
      const gl = j > 0 ? g[j - 1] : 0, gr = j < Ne - 1 ? g[j] : 0;
      a[j] = -gl; c[j] = -gr; b[j] = m + gl + gr;
      d[j] = m * x[o + j] + P.src[j] * I * P.dx[j];
    }
    thomas(a, b, c, d, Ne);
    // Positivity limiter that conserves lithium: a cell that would fall below the floor is topped up
    // with exactly the amount taken from its neighbour (first sweeping toward the cathode, then back).
    const fl = P.ceFloor;
    for (let j = 0; j < Ne - 1; j++) if (d[j] < fl) {
      d[j + 1] -= (fl - d[j]) * P.eps[j] * P.dx[j] / (P.eps[j + 1] * P.dx[j + 1]); d[j] = fl;
    }
    for (let j = Ne - 1; j > 0; j--) if (d[j] < fl) {
      d[j - 1] -= (fl - d[j]) * P.eps[j] * P.dx[j] / (P.eps[j - 1] * P.dx[j - 1]); d[j] = fl;
    }
    for (let j = 0; j < Ne; j++) x[o + j] = d[j];
  }

  function newOut() {
    return { V: 0, etaPl: 0, PhiN: 0, PhiP: 0, thssN: 0, thssP: 0, thbN: 0, thbP: 0, soc: 0,
             ceMin: 0, ceMax: 0, T: 0, iSei: 0, iPl: 0, Qgen: 0, etaN: 0, etaP: 0, dPhiE: 0, I: 0 };
  }

  // algebraic outputs for state x under applied current I
  function outputs(P, x, I, o) {
    const n = P.n, p = P.p, N = P.Nr, T = x[P.iT];
    const rtf = RG * T / F;
    // --- solid: bulk averages and surface concentrations
    let sn = 0, sp = 0;
    for (let i = 0; i < N; i++) { sn += P.w[i] * x[P.iN + i]; sp += P.w[i] * x[P.iP + i]; }
    const thbN = sn / P.wsum / n.cmax, thbP = sp / P.wsum / p.cmax;
    const jn = I / (F * n.S), jp = -I / (F * p.S);
    const DsN = n.Ds * arr(n.EaDs, T), DsP = p.Ds * arr(p.EaDs, T);
    let cssN = x[P.iN + N - 1] + jn * (n.R / N) / (2 * DsN);
    let cssP = x[P.iP + N - 1] + jp * (p.R / N) / (2 * DsP);
    const lim = 1e-4;
    let thN = cssN / n.cmax, thP = cssP / p.cmax;
    const thNc = thN < lim ? lim : thN > 1 - lim ? 1 - lim : thN;
    const thPc = thP < lim ? lim : thP > 1 - lim ? 1 - lim : thP;
    // --- electrolyte: averages, potential profile
    const Ne = P.Ne, oe = P.iE, lnc = P._lnc, phi = P._phi;
    const aK = arr(P.EaKappa, T), iA = I / P.A, kd = 2 * rtf * (1 - P.tplus);
    let ceN = 0, ceP = 0, phiN = 0, phiP = 0, rPrev = 0, phiSep = 0;
    for (let j = 0; j < Ne; j++) {
      const cj = x[oe + j];
      lnc[j] = Math.log(cj);
      const kap = Math.max(P.kappa(cj) * aK, 1e-4) * P.bg[j];
      const r = P.dx[j] / (2 * kap);
      if (j === 0) phi[0] = 0;
      else phi[j] = phi[j - 1] + iA * P.fI[j - 1] * (rPrev + r) + kd * (lnc[j] - lnc[j - 1]);
      if (j === P.Nn) {
        // potential at the anode | separator interface (ohmic to the face + half the ln-c step)
        phiSep = phi[j - 1] + iA * rPrev + 0.5 * kd * (lnc[j] - lnc[j - 1]);
      }
      if (j < P.Nn) { ceN += cj; phiN += phi[j]; }
      else if (j >= P.Nn + P.Ns) { ceP += cj; phiP += phi[j]; }
      rPrev = r;
    }
    ceN /= P.Nn; ceP /= P.Np; phiN /= P.Nn; phiP /= P.Np;
    // --- kinetics
    const i0n = n.k * arr(n.Eak, T) * Math.sqrt(ceN) * n.cmax * Math.sqrt(thNc * (1 - thNc));
    const i0p = p.k * arr(p.Eak, T) * Math.sqrt(ceP) * p.cmax * Math.sqrt(thPc * (1 - thPc));
    const etaN = -2 * rtf * Math.asinh(I / (2 * n.S * i0n));
    const etaP = 2 * rtf * Math.asinh(I / (2 * p.S * i0p));
    const PhiN = P.Un(thNc) + etaN;          // phi_s - phi_e, anode (electrode average)
    const PhiP = P.Up(thPc) + etaP;          // phi_s - phi_e, cathode (electrode average)
    const V = PhiP - PhiN + (phiP - phiN) + I * P.Rsolid;
    const etaPl = PhiN - (phiSep - phiN);  // phi_s - phi_e at the anode | separator interface, U_pl = 0
    // --- side reactions [A per m^2 of anode surface]
    const iSei = P.i0sei * arr(P.EaSei, T) * Math.exp(Math.min(-P.alphaSei * (PhiN - P.Usei) / rtf, 40));
    // (the plating current cannot exceed the applied current density)
    let iPl = etaPl < 0 ? P.i0pl * (Math.exp(Math.min(-P.alphaPl * etaPl / rtf, 40)) - 1) : 0;
    const iApp = I > 0 ? I / n.S : 0;
    if (iPl > iApp) iPl = iApp;
    o.V = V; o.etaPl = etaPl; o.PhiN = PhiN; o.PhiP = PhiP;
    o.thssN = thN; o.thssP = thP; o.thbN = thbN; o.thbP = thbP;
    o.soc = (thbN - n.th0) / (n.th100 - n.th0);
    o.ceMin = x[oe]; o.ceMax = x[oe + Ne - 1];
    o.T = T; o.iSei = iSei; o.iPl = iPl; o.etaN = etaN; o.etaP = etaP; o.dPhiE = phiP - phiN; o.I = I;
    o.Qgen = I * (V - (P.Up(thbP) - P.Un(thbN)));
    return o;
  }

  // Lithium inventory [mol]: solid phase (both electrodes) and electrolyte phase.
  function lithium(P, x) {
    let sn = 0, sp = 0, e = 0;
    for (let i = 0; i < P.Nr; i++) { sn += P.w[i] * x[P.iN + i]; sp += P.w[i] * x[P.iP + i]; }
    for (let j = 0; j < P.Ne; j++) e += P.eps[j] * P.dx[j] * x[P.iE + j];
    const nN = P.n.epsS * P.n.L * P.A * sn / P.wsum, nP = P.p.epsS * P.p.L * P.A * sp / P.wsum;
    return { anode: nN, cathode: nP, solid: nN + nP, elyte: e * P.A };
  }

  // advance one step under constant current; outputs describe the END of the step
  function step(P, x, I, dt, Tamb, o) {
    const n = P.n, p = P.p, T = x[P.iT];
    stepParticle(P, x, P.iN, n.Ds * arr(n.EaDs, T), n.R, I / (F * n.S), dt);
    stepParticle(P, x, P.iP, p.Ds * arr(p.EaDs, T), p.R, -I / (F * p.S), dt);
    stepElectrolyte(P, x, I, T, dt);
    outputs(P, x, I, o);
    const k = dt / P.Cth;
    x[P.iT] = (T + k * (o.Qgen + P.hA * Tamb)) / (1 + k * P.hA);
    x[P.iQs] += o.iSei * n.S * dt / 3600;
    x[P.iQp] += o.iPl * n.S * dt / 3600;
    o.T = x[P.iT];
    return o;
  }

  // ---------------------------------------------------------------- controllers
  // Constraint codes (also used to report which constraint is active)
  const CON = { NONE: 0, PLATING: 1, TEMP: 2, CE: 3, CATHODE: 4, ANODE: 5, VOLT: 6 };

  // CC-CV: the only "constraint" is the terminal-voltage ceiling.
  function checkCCCV(c) { return function (o) { return o.V > c.Vmax ? CON.VOLT : 0; }; }

  // Reference governor: constraints on the internal electrochemical / thermal states.
  function checkRG(P, c) {
    return function (o) {
      if (o.etaPl < c.etaMin) return CON.PLATING;
      if (o.T > c.Tmax) return CON.TEMP;
      if (o.ceMin < c.ceMin) return CON.CE;
      if (o.PhiP > c.PhiPmax) return CON.CATHODE;
      if (o.thssN > c.thNmax) return CON.ANODE;
      return 0;
    };
  }

  /*
   * Simulate one charge.
   *   scen: { soc0, socT, Tamb [K], dt [s], tmax [s] }
   *   ctrl: { type: 'cccv', Imax [A], Vmax }  or
   *         { type: 'rg',   Imax [A], etaMin [V], Tmax [K], ceMin, horizon (steps) }
   * Both controllers apply, at every step, the largest current in [0, Imax] for which the
   * model-predicted outputs stay admissible over the look-ahead horizon (scalar reference governor).
   * For CC-CV the admissible set is just V <= Vmax, which reproduces constant-current / constant-voltage.
   */
  function simulate(P, scen, ctrl) {
    // base step dt; long charges coarsen to 2*dt after 30 min and 4*dt after 90 min
    const dt0 = scen.dt || 2, tmax = scen.tmax || 5 * 3600, Tamb = scen.Tamb;
    const maxN = Math.ceil(Math.min(tmax, 1800) / dt0) + Math.ceil(Math.max(0, Math.min(tmax, 5400) - 1800) / (2 * dt0))
      + Math.ceil(Math.max(0, tmax - 5400) / (4 * dt0)) + 2;
    let dt = dt0;
    const x = initState(P, scen.soc0, Tamb), xs = new Float64Array(P.nx);
    const o = newOut(), ot = newOut();
    const check = ctrl.type === 'cccv'
      ? checkCCCV(ctrl)
      : checkRG(P, { etaMin: ctrl.etaMin, Tmax: ctrl.Tmax, ceMin: ctrl.ceMin == null ? 100 : ctrl.ceMin,
                     PhiPmax: P.PhiPmax, thNmax: 0.99 });
    const H = ctrl.type === 'cccv' ? 1 : Math.max(1, ctrl.horizon || 3);
    const Icut = P.Qcell / 20, Imax = ctrl.Imax;
    const keys = ['t', 'I', 'V', 'soc', 'etaPl', 'T', 'thssN', 'thssP', 'thbN', 'thbP', 'ceMin', 'ceMax',
                  'PhiP', 'PhiN', 'Qsei', 'Qpl', 'active'];
    const R = {}; for (const k of keys) R[k] = new Float64Array(maxN);
    const X = new Float32Array(maxN * P.nx);

    let lastBad = 0;
    function trial(I) {
      xs.set(x);
      for (let h = 0; h < H; h++) {
        step(P, xs, I, dt, Tamb, ot);
        const v = check(ot);
        if (v) { lastBad = v; return false; }
      }
      return true;
    }
    function record(k, t, I, active) {
      R.t[k] = t; R.I[k] = I; R.V[k] = o.V; R.soc[k] = o.soc; R.etaPl[k] = o.etaPl; R.T[k] = x[P.iT];
      R.thssN[k] = o.thssN; R.thssP[k] = o.thssP; R.thbN[k] = o.thbN; R.thbP[k] = o.thbP;
      R.ceMin[k] = o.ceMin; R.ceMax[k] = o.ceMax; R.PhiP[k] = o.PhiP; R.PhiN[k] = o.PhiN;
      R.Qsei[k] = x[P.iQs]; R.Qpl[k] = x[P.iQp]; R.active[k] = active;
      X.set(x, k * P.nx);
    }

    outputs(P, x, 0, o);
    record(0, 0, 0, 0);
    const li0 = lithium(P, x); let dLiS = 0, dLiE = 0, dLiQ = 0, qMol = 0;
    let k = 0, t = 0, reached = false, Iprev = Imax, stalled = 0, tPlate = 0, depleted = false;
    while (k < maxN - 1 && t < tmax) {
      dt = t < 1800 ? dt0 : t < 5400 ? 2 * dt0 : 4 * dt0;
      let I, active = CON.NONE;
      if (trial(Imax)) I = Imax;
      else {
        let lo = 0, hi = Imax;
        // warm start: bracket around the previous current
        const a = Math.max(0, Iprev - 0.04 * Imax), b = Math.min(Imax, Iprev + 0.04 * Imax);
        if (a > 0 && trial(a)) lo = a; else if (a > 0) hi = a;
        if (hi > b && b > lo) { if (trial(b)) lo = b; else hi = b; }
        for (let it = 0; it < 12 && hi - lo > 2e-3 * Imax; it++) {
          const mid = 0.5 * (lo + hi);
          if (trial(mid)) lo = mid; else hi = mid;
        }
        I = lo; trial(hi); active = lastBad;
      }
      step(P, x, I, dt, Tamb, o);
      Iprev = I; k++; t += dt;
      record(k, t, I, active);
      if (o.etaPl < 0) tPlate += dt;
      if (o.ceMin < 5) depleted = true;
      // conservation diagnostics: drift of each inventory, and anode uptake vs. charge passed
      const li = lithium(P, x); qMol += I * dt / F;
      dLiS = Math.max(dLiS, Math.abs(li.solid - li0.solid) / li0.solid);
      dLiE = Math.max(dLiE, Math.abs(li.elyte - li0.elyte) / li0.elyte);
      dLiQ = Math.max(dLiQ, Math.abs(li.anode - li0.anode - qMol) / li0.solid);
      if (o.soc >= scen.socT) { reached = true; break; }
      // give up when the admissible current has collapsed below C/20 for a sustained period
      if (I < Icut) { stalled += dt; if (stalled >= 120) break; } else stalled = 0;
    }
    const n = k + 1;
    for (const q of keys) R[q] = R[q].subarray(0, n);
    R.n = n; R.X = X.subarray(0, n * P.nx); R.reached = reached; R.depleted = depleted;
    R.liSolid = li0.solid; R.liElyte = li0.elyte; R.liSolidDrift = dLiS; R.liElyteDrift = dLiE; R.liCoulombErr = dLiQ;
    R.time = t; R.socEnd = R.soc[n - 1];
    R.lossSei = R.Qsei[n - 1]; R.lossPl = R.Qpl[n - 1]; R.loss = R.lossSei + R.lossPl;
    let Tpk = -1e9, etaMin = 1e9, Vpk = 0, Ipk = 0;
    for (let i = 1; i < n; i++) {
      if (R.T[i] > Tpk) Tpk = R.T[i];
      if (R.etaPl[i] < etaMin) etaMin = R.etaPl[i];
      if (R.V[i] > Vpk) Vpk = R.V[i];
      if (R.I[i] > Ipk) Ipk = R.I[i];
    }
    R.Tpeak = Tpk; R.etaPlMin = etaMin; R.Vpeak = Vpk; R.Ipeak = Ipk; R.tPlating = tPlate;
    return R;
  }

  // CC-CV trade-off curve: charge time and capacity loss for a list of C-rates
  function sweepCCCV(P, scen, Vmax, rates) {
    const s = Object.assign({}, scen, { dt: 4 });
    return rates.map(function (c) {
      const r = simulate(P, s, { type: 'cccv', Imax: c * P.Qcell, Vmax: Vmax });
      return { c: c, time: r.time, loss: r.loss, lossPl: r.lossPl, reached: r.reached, etaPlMin: r.etaPlMin,
               Tpeak: r.Tpeak, depleted: r.depleted };
    });
  }

  // Fastest CC-CV rate whose trajectory respects the same plating-margin and temperature limits.
  function safeCCCV(P, scen, Vmax, lim, cHi) {
    const s = Object.assign({}, scen, { dt: 4 });
    function run(c) { return simulate(P, s, { type: 'cccv', Imax: c * P.Qcell, Vmax: Vmax }); }
    function ok(r) { return r.etaPlMin >= lim.etaMin - 1e-4 && r.Tpeak <= lim.Tmax + 0.02; }
    let lo = 0.1, hi = cHi || 3, rLo = run(lo);
    if (!ok(rLo)) return null;
    const rHi = run(hi);
    if (ok(rHi)) return { c: hi, time: rHi.time, loss: rHi.loss, reached: rHi.reached, capped: true };
    for (let i = 0; i < 7; i++) {
      const mid = 0.5 * (lo + hi), r = run(mid);
      if (ok(r)) { lo = mid; rLo = r; } else hi = mid;
    }
    return { c: lo, time: rLo.time, loss: rLo.loss, reached: rLo.reached, capped: false };
  }

  return { F, RG, TREF, BASE, CELLS, CON, sweepCCCV, safeCCCV, lithium, Un, Up, DeNyman, kappaNyman, makeCell, initState, outputs, step,
           simulate, ocv, socToTheta, newOut };
});

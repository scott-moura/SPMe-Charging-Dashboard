/*
 * Runs this repo's SPMe on the cases used for the PyBaMM cross-check and writes them to JSON.
 * NMC cell against PyBaMM's Chen2020 set; LFP cell against PyBaMM's Prada2013 set (end of file).
 *   node tests/crosscheck_export.js > spme_cases.json
 *
 * To match PyBaMM's Chen2020 parameter set exactly, the extra temperature dependences this tool adds
 * (D_s, D_e, kappa) and both side reactions are switched off; only the reaction rates keep their
 * Arrhenius law. Thermal cases use PyBaMM's lumped parameters for this cell:
 *   C_th = rho*cp_eff * V_cell = 42.8 J/K,  h*A = 10 W/m2/K * 5.31e-3 m2.
 */
const S = require('../spme.js');
const K = 273.15;
const MATCH = { i0sei: 0, i0pl: 0, EaDe: 0, EaKappa: 0, n: { EaDs: 0 }, p: { EaDs: 0 } };
const RHOCP = (12 * 8960 * 385 + 85.2 * 1657 * 700 + 12 * 397 * 700 + 75.6 * 3262 * 700 + 16 * 2700 * 897) / 200.8;  // J/m3/K
const THERMAL = { Cth: RHOCP * 2.42e-5, h: 10 }, ISO = { Cth: 1e15 };
const soc0 = 0.1, socT = 0.8;
const out = { soc0, socT, cases: [] };
function blank(name, P, Tamb, thermal) {
  const th = S.socToTheta(P, soc0);
  return { name, Tamb, thermal, csn0: th.n * P.n.cmax, csp0: th.p * P.p.cmax,
           t: [], I: [], V: [], T: [], thssN: [], thssP: [], ce0: [], ceL: [], etaPl: [], soc: [] };
}
// constant-current charges
for (const c of [
  { name: 'CC 0.5C, isothermal 25 C', rate: 0.5, Tamb: 25 }, { name: 'CC 1C, isothermal 25 C', rate: 1.0, Tamb: 25 },
  { name: 'CC 1.5C, isothermal 25 C', rate: 1.5, Tamb: 25 }, { name: 'CC 2C, isothermal 25 C', rate: 2.0, Tamb: 25 },
  { name: 'CC 1C, isothermal 10 C', rate: 1.0, Tamb: 10 },   { name: 'CC 1.5C, isothermal 40 C', rate: 1.5, Tamb: 40 },
  { name: 'CC 1C, lumped thermal 25 C', rate: 1.0, Tamb: 25, thermal: true }, { name: 'CC 1.5C, lumped thermal 25 C', rate: 1.5, Tamb: 25, thermal: true },
]) {
  const P = S.makeCell(Object.assign({}, MATCH, c.thermal ? THERMAL : ISO));
  const I = c.rate * P.Qcell, dt = 2, x = S.initState(P, soc0, c.Tamb + K), o = S.newOut(), r = blank(c.name, P, c.Tamb + K, !!c.thermal);
  for (let k = 1; k <= 20000; k++) {
    S.step(P, x, I, dt, c.Tamb + K, o);
    r.t.push(k * dt); r.I.push(I); r.V.push(o.V); r.T.push(o.T); r.thssN.push(o.thssN); r.thssP.push(o.thssP);
    r.ce0.push(o.ceMin); r.ceL.push(o.ceMax); r.etaPl.push(o.etaPl); r.soc.push(o.soc);
    if (o.soc >= socT || o.V > 4.45) break;
  }
  out.cases.push(r);
}
// closed-loop charges: the current profile each controller produces here is replayed in PyBaMM
for (const c of [
  { name: 'governor profile, isothermal 25 C', ctrl: P => ({ type: 'rg', Imax: 3 * P.Qcell, etaMin: 0.005, Tmax: 45 + K }) },
  { name: 'CC-CV 1C profile, isothermal 25 C', ctrl: P => ({ type: 'cccv', Imax: P.Qcell, Vmax: 4.2 }) },
  { name: 'governor profile, lumped thermal 25 C', thermal: true, ctrl: P => ({ type: 'rg', Imax: 3 * P.Qcell, etaMin: 0.005, Tmax: 45 + K }) },
  { name: 'CC-CV 1C profile, lumped thermal 25 C', thermal: true, ctrl: P => ({ type: 'cccv', Imax: P.Qcell, Vmax: 4.2 }) },
]) {
  const P = S.makeCell(Object.assign({}, MATCH, c.thermal ? THERMAL : ISO));
  const R = S.simulate(P, { soc0, socT, Tamb: 25 + K, dt: 2 }, c.ctrl(P)), r = blank(c.name, P, 25 + K, !!c.thermal);
  r.replay = true;
  for (let i = 1; i < R.n; i++) {
    r.t.push(R.t[i]); r.I.push(R.I[i]); r.V.push(R.V[i]); r.T.push(R.T[i]); r.thssN.push(R.thssN[i]); r.thssP.push(R.thssP[i]);
    r.ce0.push(R.ceMin[i]); r.ceL.push(R.ceMax[i]); r.etaPl.push(R.etaPl[i]); r.soc.push(R.soc[i]);
  }
  out.cases.push(r);
}
// the dashboard's own default configuration (extra Arrhenius laws on, C_th = 68 J/K, h = 25 W/m2/K);
// the PyBaMM script applies the same changes to the Chen2020 set before replaying these profiles in the DFN
for (const c of [
  { name: 'dashboard default: governor, 5 mV margin', ctrl: P => ({ type: 'rg', Imax: 3 * P.Qcell, etaMin: 0.005, Tmax: 45 + K }) },
  { name: 'dashboard default: governor, 15 mV margin', ctrl: P => ({ type: 'rg', Imax: 3 * P.Qcell, etaMin: 0.015, Tmax: 45 + K }) },
  { name: 'dashboard default: CC-CV 1C', ctrl: P => ({ type: 'cccv', Imax: P.Qcell, Vmax: 4.2 }) },
]) {
  const P = S.makeCell();
  const R = S.simulate(P, { soc0, socT, Tamb: 25 + K, dt: 2 }, c.ctrl(P)), r = blank(c.name, P, 25 + K, true);
  r.replay = true; r.app = { Cth: P.Cth, h: P.h, EaDsN: P.n.EaDs, EaDsP: P.p.EaDs, EaDe: P.EaDe, EaKappa: P.EaKappa };
  for (let i = 1; i < R.n; i++) {
    r.t.push(R.t[i]); r.I.push(R.I[i]); r.V.push(R.V[i]); r.T.push(R.T[i]); r.thssN.push(R.thssN[i]); r.thssP.push(R.thssP[i]);
    r.ce0.push(R.ceMin[i]); r.ceL.push(R.ceMax[i]); r.etaPl.push(R.etaPl[i]); r.soc.push(R.soc[i]);
  }
  out.cases.push(r);
}
// ---- LFP cell (A123 26650), matched to PyBaMM's Prada2013 set: that set is isothermal with constant D_s and D_e,
// so the Arrhenius laws this tool adds from Prada 2012 are switched off (reaction rates keep theirs, as in PyBaMM).
const MATCH_LFP = { i0sei: 0, i0pl: 0, EaDe: 0, EaKappa: 0, n: { EaDs: 0 }, p: { EaDs: 0 }, Cth: 1e15 };
function push(r, t, I, o) {
  r.t.push(t); r.I.push(I); r.V.push(o.V); r.T.push(o.T); r.thssN.push(o.thssN); r.thssP.push(o.thssP);
  r.ce0.push(o.ceMin); r.ceL.push(o.ceMax); r.etaPl.push(o.etaPl); r.soc.push(o.soc);
}
for (const c of [
  { name: 'LFP: CC 1C, isothermal 25 C', rate: 1, Tamb: 25 }, { name: 'LFP: CC 2C, isothermal 25 C', rate: 2, Tamb: 25 },
  { name: 'LFP: CC 4C, isothermal 25 C', rate: 4, Tamb: 25 }, { name: 'LFP: CC 1C, isothermal 10 C', rate: 1, Tamb: 10 },
]) {
  const P = S.makeCell(MATCH_LFP, 'lfp');
  const I = c.rate * P.Qcell, dt = 2, x = S.initState(P, soc0, c.Tamb + K), o = S.newOut(), r = blank(c.name, P, c.Tamb + K, false);
  r.cell = 'lfp';
  for (let k = 1; k <= 20000; k++) { S.step(P, x, I, dt, c.Tamb + K, o); push(r, k * dt, I, o); if (o.soc >= socT || o.V > 3.9) break; }
  out.cases.push(r);
}
for (const c of [
  { name: 'LFP: governor profile, isothermal 25 C', ctrl: P => ({ type: 'rg', Imax: 4 * P.Qcell, etaMin: 0.005, Tmax: 45 + K }) },
  { name: 'LFP: CC-CV 2C profile, isothermal 25 C', ctrl: P => ({ type: 'cccv', Imax: 2 * P.Qcell, Vmax: 3.6 }) },
]) {
  const P = S.makeCell(MATCH_LFP, 'lfp');
  const R = S.simulate(P, { soc0, socT, Tamb: 25 + K, dt: 2 }, c.ctrl(P)), r = blank(c.name, P, 25 + K, false);
  r.replay = true; r.cell = 'lfp';
  for (let i = 1; i < R.n; i++) push(r, R.t[i], R.I[i], { V: R.V[i], T: R.T[i], thssN: R.thssN[i], thssP: R.thssP[i], ceMin: R.ceMin[i], ceMax: R.ceMax[i], etaPl: R.etaPl[i], soc: R.soc[i] });
  out.cases.push(r);
}
process.stdout.write(JSON.stringify(out));

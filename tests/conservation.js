/*
 * Lithium conservation test for the SPMe discretisation.   Run:  node tests/conservation.js
 *
 * With the side reactions switched off, the finite-volume scheme should neither create nor destroy
 * lithium in either phase, for any input current:
 *   solid phase:  n_s = eps_s,n L_n A <c_s,n> + eps_s,p L_p A <c_s,p>   stays constant
 *   electrolyte:  n_e = A * sum_j eps_e,j dx_j c_e,j                     stays constant
 * and the lithium gained by the anode should equal the charge passed, integral(I dt) / F.
 */
const S = require('../spme.js');
const F = S.F, K = 273.15, TOL = 1e-10;
let P, C, VMAX;
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
let fail = 0;
function report(name, li0, dS, dE, dQ, minCe) {
  const ok = dS < TOL && dE < TOL && dQ < TOL; if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(40) + ' solid ' + dS.toExponential(1) + '   electrolyte ' + dE.toExponential(1) +
    '   anode-vs-coulombs ' + dQ.toExponential(1) + '   min c_e ' + minCe.toFixed(0).padStart(5));
}
function openLoop(name, soc0, Tamb, currentAt, dtAt, nSteps) {
  const x = S.initState(P, soc0, Tamb), o = S.newOut(), m0 = S.lithium(P, x);
  let dS = 0, dE = 0, dQ = 0, q = 0, minCe = 1e9, t = 0;
  for (let k = 0; k < nSteps; k++) {
    const dt = dtAt(k), I = currentAt(k, t);
    S.step(P, x, I, dt, Tamb, o); t += dt; q += I * dt / F;
    const m = S.lithium(P, x);
    dS = Math.max(dS, Math.abs(m.solid - m0.solid) / m0.solid);
    dE = Math.max(dE, Math.abs(m.elyte - m0.elyte) / m0.elyte);
    dQ = Math.max(dQ, Math.abs(m.anode - m0.anode - q) / m0.solid);
    minCe = Math.min(minCe, o.ceMin);
  }
  report(name, m0, dS, dE, dQ, minCe);
}
function closedLoop(name, scen, ctrl) {
  const R = S.simulate(P, scen, ctrl); let minCe = 1e9; for (let i = 0; i < R.n; i++) minCe = Math.min(minCe, R.ceMin[i]);
  report(name, null, R.liSolidDrift, R.liElyteDrift, R.liCoulombErr, minCe);
}
for (const [cell, vmax] of [['nmc', 4.2], ['lfp', 3.6]]) {
  P = S.makeCell({ i0sei: 0, i0pl: 0 }, cell);     // no SEI growth, no plating
  C = P.Qcell; VMAX = vmax;
  console.log('\n=== ' + P.name + ', ' + C.toFixed(3) + ' Ah ===');
  const m = S.lithium(P, S.initState(P, 0.1, 298.15));
  console.log('Inventory at 10 % SOC: solid ' + m.solid.toFixed(6) + ' mol (anode ' + m.anode.toFixed(6) + ', cathode ' + m.cathode.toFixed(6) + '), electrolyte ' + m.elyte.toExponential(6) + ' mol');
  console.log('Maximum relative drift over each run (tolerance ' + TOL + '):\n');
  openLoop('CC 1C, 25 C, 40 min',                   0.1, K + 25, () => C,     () => 2, 1200);
  openLoop('CC 2C, 25 C, 15 min',                   0.1, K + 25, () => 2 * C, () => 2, 450);
  openLoop('CC 3C, 25 C, 12 min',        0.1, K + 25, () => 3 * C, () => 2, 360);
  openLoop('CC 1C, -10 C, 40 min',       0.1, K - 10, () => C,     () => 2, 1200);
  openLoop('CC 4C, 0 C, 10 min',    0.1, K,      () => 4 * C, () => 2, 300);
  openLoop('discharge 2C, 25 C, 20 min',            0.9, K + 25, () => -2 * C, () => 2, 600);
  openLoop('random +-3C pulses, dt 1-8 s',          0.5, K + 25, () => (rnd() * 6 - 3) * C, () => 1 + Math.floor(rnd() * 8), 3000);
  openLoop('sine, 2C amplitude, 1 mHz',             0.5, K + 25, (k, t) => 2 * C * Math.sin(2 * Math.PI * t / 1000), () => 2, 3000);
  openLoop('rest (I = 0), 1 h',                     0.5, K + 25, () => 0,     () => 4, 900);
  closedLoop('CC-CV 1C, 10-80 %, 25 C',             { soc0: .1, socT: .8, Tamb: K + 25, dt: 2 }, { type: 'cccv', Imax: C, Vmax: VMAX });
  closedLoop('governor, 10-80 %, 25 C',             { soc0: .1, socT: .8, Tamb: K + 25, dt: 2 }, { type: 'rg', Imax: 3 * C, etaMin: .005, Tmax: K + 45 });
  closedLoop('CC-CV 3C, 10-80 %, 25 C',  { soc0: .1, socT: .8, Tamb: K + 25, dt: 2 }, { type: 'cccv', Imax: 3 * C, Vmax: VMAX });
  closedLoop('CC-CV 2.5C, 10-80 %, 10 C',{ soc0: .1, socT: .8, Tamb: K + 10, dt: 2 }, { type: 'cccv', Imax: 2.5 * C, Vmax: VMAX });
  closedLoop('governor, 0-100 %, 0 C',              { soc0: 0, socT: 1, Tamb: K, dt: 2 },        { type: 'rg', Imax: 3 * C, etaMin: .005, Tmax: K + 45 });
}
console.log('\n' + (fail ? fail + ' case(s) FAILED' : 'All cases conserve lithium to round-off.'));
process.exit(fail ? 1 : 0);

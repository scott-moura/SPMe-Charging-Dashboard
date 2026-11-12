/* app.js — UI, plots and orchestration for the fast-charging simulator. Depends on spme.js. */
(function () {
  'use strict';
  const S = window.SPMe, K = 273.15;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  // ------------------------------------------------------------------ controls
  const CTRL = [
    { id: 'soc0', g: 'scen', label: 'Initial SOC', min: 0, max: 90, step: 1, val: 10, f: v => v + ' %' },
    { id: 'socT', g: 'scen', label: 'Target SOC', min: 20, max: 100, step: 1, val: 80, f: v => v + ' %' },
    { id: 'Tamb', g: 'scen', label: 'Ambient temperature', min: -10, max: 45, step: 1, val: 25, f: v => v + ' °C',
      hint: 'The cell starts at ambient.' },
    { id: 'h', g: 'scen', label: 'Cooling', min: 5, max: 100, step: 5, val: 25, f: v => v + ' W/m²K',
      hint: 'Convection coefficient: ~10 still air, ~100 liquid-cooled.' },
    { id: 'etaMin', g: 'rg', label: 'Plating overpotential limit', min: -20, max: 40, step: 1, val: 5,
      f: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' mV',
      hint: 'Keep η_pl at or above this. 0 mV is the plating threshold. Against a full DFN model this estimate reads up to about 13 mV high mid-charge, so 15 mV or more is needed to cover that.' },
    { id: 'Tmax', g: 'rg', label: 'Temperature limit', min: 30, max: 60, step: 1, val: 45, f: v => v + ' °C' },
    { id: 'ImaxRG', g: 'rg', label: 'Maximum current', min: 1, max: 4, step: 0.1, val: 3, f: v => v.toFixed(1) + ' C',
      hint: 'Charger / hardware ceiling.' },
    { id: 'crate', g: 'cccv', label: 'CC rate', min: 0.3, max: 3, step: 0.05, val: 1, f: v => v.toFixed(2) + ' C' },
    { id: 'Vmax', g: 'cccv', label: 'CV voltage', min: 4.0, max: 4.2, step: 0.01, val: 4.2, f: v => v.toFixed(2) + ' V' },
  ];
  // What changes with the cell: slider ranges and defaults for the three rate / voltage controls,
  // the CC-CV rates swept for the trade-off chart, presets, and page text.
  const ETA_HINT = 'Keep η_pl at or above this. 0 mV is the plating threshold. ';
  const CELLUI = {
    nmc: {
      tab: 'NMC811 · 5 Ah', note: 'LG M50 21700, NMC811 / graphite-SiOx. Parameters: Chen et al. 2020.',
      blurb: 'a 5 Ah NMC811 / graphite cell (LG M50)',
      ctl: { ImaxRG: { min: 1, max: 4, step: 0.1, val: 3 }, crate: { min: 0.3, max: 3, step: 0.05, val: 1 },
             Vmax: { min: 4.0, max: 4.2, step: 0.01, val: 4.2 } },
      sweep: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.25, 2.5, 3], labelled: [0.5, 1, 2, 3], cHi: 3,
      presets: [{ name: 'Default', v: {} }, { name: 'Cold, 5 °C', v: { Tamb: 5 } }, { name: 'Hot, 40 °C', v: { Tamb: 40 } },
                { name: 'Aggressive 2C CC-CV', v: { crate: 2 } }, { name: 'Gentle 0.5C CC-CV', v: { crate: 0.5 } }],
      etaHint: ETA_HINT + 'Against a full DFN model this estimate reads up to about 13 mV high mid-charge, so 15 mV or more is needed to cover that.',
    },
    lfp: {
      tab: 'LFP · 2.3 Ah', note: 'A123 ANR26650M1, LiFePO₄ / graphite. Parameters: Prada et al. 2013 as tabulated in PyBaMM.',
      blurb: 'a 2.3 Ah LiFePO₄ / graphite cell (A123 26650)',
      ctl: { ImaxRG: { min: 1, max: 8, step: 0.1, val: 4 }, crate: { min: 0.5, max: 6, step: 0.05, val: 2 },
             Vmax: { min: 3.45, max: 3.65, step: 0.01, val: 3.6 } },
      sweep: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4, 5, 6], labelled: [0.5, 1, 2, 4, 6], cHi: 6,
      presets: [{ name: 'Default', v: {} }, { name: 'Cold, 5 °C', v: { Tamb: 5 } }, { name: 'Hot, 40 °C', v: { Tamb: 40 } },
                { name: 'Datasheet fast charge, 10 A', v: { crate: 4.35 } }, { name: 'Gentle 1C CC-CV', v: { crate: 1 } }],
      etaHint: ETA_HINT + 'For this cell the estimate matched a DFN replay to within 1 mV at its lowest point (25 °C, isothermal).',
    },
  };
  let cellId = 'nmc', UI = CELLUI.nmc;
  const p = {}; const inputs = {}, outs = {}, hints = {};
  CTRL.forEach(c => {
    p[c.id] = c.val;
    const w = el('div', 'ctl ' + c.g), lab = el('label'), o = el('output', null, c.f(c.val));
    lab.htmlFor = 'in-' + c.id; lab.append(el('span', null, c.label), o);
    const inp = el('input'); inp.type = 'range'; inp.id = 'in-' + c.id; inp.min = c.min; inp.max = c.max; inp.step = c.step; inp.value = c.val;
    w.append(lab, inp); if (c.hint) { hints[c.id] = el('small', null, c.hint); w.append(hints[c.id]); }
    $('#g-' + c.g).append(w); inputs[c.id] = inp; outs[c.id] = o;
    inp.addEventListener('input', () => { setVal(c.id, +inp.value, true); schedule(); });
  });
  const cdef = id => CTRL.find(c => c.id === id);
  function setVal(id, v, fromUser) {
    const c = cdef(id); v = Math.min(c.max, Math.max(c.min, v));
    p[id] = v; inputs[id].value = v; outs[id].textContent = c.f(v);
    if (fromUser) {            // keep target at least 5 % above the initial SOC
      if (id === 'soc0' && p.socT < v + 5) setVal('socT', v + 5);
      if (id === 'socT' && p.soc0 > v - 5) setVal('soc0', v - 5);
    }
  }
  function buildPresets() {
    const host = $('#presets'); host.textContent = '';
    UI.presets.forEach(ps => {
      const b = el('button', null, ps.name); b.type = 'button';
      b.addEventListener('click', () => { CTRL.forEach(c => setVal(c.id, ps.v[c.id] != null ? ps.v[c.id] : c.val)); schedule(); });
      host.append(b);
    });
  }
  // switch cell: new parameter set, new ranges and defaults for the rate / voltage sliders (scenario sliders keep their values)
  function setCell(id) {
    cellId = id; UI = CELLUI[id]; P = S.makeCell(null, id);
    Object.keys(UI.ctl).forEach(k => {
      const c = cdef(k), inp = inputs[k]; Object.assign(c, UI.ctl[k]);
      inp.min = c.min; inp.max = c.max; inp.step = c.step; setVal(k, c.val);
    });
    hints.etaMin.textContent = UI.etaHint;
    buildPresets();
    document.querySelectorAll('#cellsel button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cell === id)));
    $('#cellnote').textContent = UI.note; $('#cellblurb').textContent = UI.blurb;
    $('#pareto-range').textContent = 'every CC-CV rate from ' + UI.sweep[0] + 'C to ' + UI.cHi + 'C, against the governor';
    sweep = null; safe = null;
  }
  Object.keys(CELLUI).forEach(id => {
    const b = el('button', null, CELLUI[id].tab); b.type = 'button'; b.dataset.cell = id;
    b.addEventListener('click', () => { if (id !== cellId) { setCell(id); schedule(); } });
    $('#cellsel').append(b);
  });

  // ------------------------------------------------------------------ colours
  const C = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    ['surface', 'ink', 'ink2', 'muted', 'grid', 'axis', 'cccv', 'rg', 'crit'].forEach(k => { C[k] = cs.getPropertyValue('--' + k).trim(); });
  }
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ------------------------------------------------------------------ plotting primitive
  function niceTicks(lo, hi, n) {
    const span = hi - lo; if (!(span > 0)) return { t: [lo], step: 1 };
    const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag, t = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) t.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { t, step };
  }
  const tickFmt = (v, step) => v.toFixed(Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))));
  const FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';

  class Plot {
    constructor(host, opt) {
      this.host = host; this.opt = opt || {};
      this.cv = el('canvas'); host.prepend(this.cv);
      this.hair = el('div', 'hair'); host.append(this.hair);
      this.m = Object.assign({ l: 44, r: 12, t: 8, b: 22 }, this.opt.margin);
      this.spec = null; this.hx = null; this.pw = 1; this.ph = 1;
      new ResizeObserver(() => { this.render(); this.setHair(this.hx); }).observe(host);
      if (this.opt.onHover) {
        const h = e => { if (!this.spec) return; this.opt.onHover(this.pxToX(e.clientX - host.getBoundingClientRect().left), e); };
        host.addEventListener('pointermove', h); host.addEventListener('pointerdown', h);
        host.addEventListener('pointerleave', () => this.opt.onLeave && this.opt.onLeave());
      }
    }
    set(spec) { this.spec = spec; this.render(); this.setHair(this.hx); }
    sx(x) { const s = this.spec; return this.m.l + (x - s.x[0]) / (s.x[1] - s.x[0]) * this.pw; }
    sy(y) {
      const s = this.spec;
      const f = s.yLog ? (Math.log(y) - Math.log(s.y[0])) / (Math.log(s.y[1]) - Math.log(s.y[0])) : (y - s.y[0]) / (s.y[1] - s.y[0]);
      return this.m.t + (1 - f) * this.ph;
    }
    pxToX(px) { const s = this.spec, f = Math.min(1, Math.max(0, (px - this.m.l) / this.pw)); return s.x[0] + f * (s.x[1] - s.x[0]); }
    setHair(x) {
      this.hx = x;
      if (x == null || !this.spec || x < this.spec.x[0] || x > this.spec.x[1]) { this.hair.style.display = 'none'; return; }
      const st = this.hair.style; st.display = 'block'; st.left = this.sx(x) + 'px'; st.top = this.m.t + 'px'; st.height = this.ph + 'px';
    }
    render() {
      const s = this.spec, host = this.host, w = host.clientWidth, h = host.clientHeight;
      if (!s || w < 40 || h < 40) return;
      const dpr = window.devicePixelRatio || 1, cv = this.cv, m = this.m;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const pw = this.pw = w - m.l - m.r, ph = this.ph = h - m.t - m.b, x0 = m.l, y0 = m.t, x1 = m.l + pw, y1 = m.t + ph;
      g.font = FONT; g.lineJoin = 'round'; g.lineCap = 'butt';
      const clampY = y => Math.min(y1, Math.max(y0, this.sy(y)));
      // region bands in x (e.g. anode | separator | cathode)
      (s.vbands || []).forEach((b, i) => {
        const a = this.sx(b.x0), c = this.sx(b.x1);
        if (i % 2 === 0) { g.fillStyle = alpha(C.muted, 0.07); g.fillRect(a, y0, c - a, ph); }
        g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(b.label, (a + c) / 2, y0 + 3);
      });
      // violation bands in y
      (s.bands || []).forEach(b => {
        const a = clampY(b.y1), c = clampY(b.y0); if (c - a < 1) return;
        g.fillStyle = alpha(C.crit, 0.12); g.fillRect(x0, a, pw, c - a);
        if (b.label && c - a > 14) { g.fillStyle = C.crit; g.textAlign = 'left'; g.textBaseline = b.top ? 'top' : 'bottom'; g.fillText(b.label, x0 + 5, b.top ? a + 3 : c - 3); }
      });
      // y grid + labels
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.lineWidth = 1;
      let yt;
      if (s.yLog) {
        yt = [];
        for (let d = Math.floor(Math.log10(s.y[0])); d <= Math.ceil(Math.log10(s.y[1])); d++)
          [1, 2, 5].forEach(k => { const v = k * Math.pow(10, d); if (v >= s.y[0] * 0.999 && v <= s.y[1] * 1.001) yt.push(v); });
        yt.forEach(v => {
          const y = Math.round(this.sy(v)) + 0.5; g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
          g.fillStyle = C.muted; g.fillText(v >= 1 ? String(Math.round(v)) : v.toFixed(v < 0.1 ? 2 : 1), x0 - 6, y);
        });
      } else {
        const nt = niceTicks(s.y[0], s.y[1], Math.max(2, Math.round(ph / 42)));
        nt.t.forEach(v => {
          const y = Math.round(this.sy(v)) + 0.5; g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
          g.fillStyle = C.muted; g.fillText(tickFmt(v, nt.step), x0 - 6, y);
        });
      }
      // x axis
      const xt = niceTicks(s.x[0], s.x[1], Math.max(2, Math.round(pw / 70)));
      g.strokeStyle = C.axis; g.beginPath(); g.moveTo(x0, y1 + 0.5); g.lineTo(x1, y1 + 0.5); g.stroke();
      g.textBaseline = 'top'; g.fillStyle = C.muted;
      let freeTo = Infinity;
      for (let i = xt.t.length - 1; i >= 0; i--) {
        const v = xt.t[i], x = this.sx(v), last = i === xt.t.length - 1;
        const txt = tickFmt(v, xt.step) + (last && s.xUnit ? ' ' + s.xUnit : ''), tw = g.measureText(txt).width;
        const al = x - x0 < 8 ? 'left' : (x + tw / 2 > x1 + m.r - 2 ? 'right' : 'center');
        const left = al === 'left' ? x : al === 'right' ? x - tw : x - tw / 2;
        if (left + tw + 6 > freeTo) continue;
        g.textAlign = al; g.fillText(txt, x, y1 + 5); freeTo = left;
      }
      // limit lines
      (s.hlines || []).forEach(l => {
        if (l.y < s.y[0] || l.y > s.y[1]) return;
        const y = Math.round(this.sy(l.y)) + 0.5;
        g.strokeStyle = C.ink2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
        if (l.label) {
          g.fillStyle = C.ink2; g.textAlign = 'right'; g.textBaseline = (y - y0 < 16 || l.below) ? 'top' : 'bottom';
          const ty = g.textBaseline === 'top' ? y + 3 : y - 3;
          g.lineWidth = 4; g.strokeStyle = C.surface; g.strokeText(l.label, x1 - 4, ty); g.lineWidth = 1;
          g.fillText(l.label, x1 - 4, ty);
        }
      });
      // data lines
      g.save(); g.beginPath(); g.rect(x0, y0 - 1, pw, ph + 2); g.clip();
      (s.lines || []).forEach(L => {
        g.strokeStyle = L.color; g.lineWidth = L.width || 2; g.setLineDash(L.dash || []);
        g.beginPath();
        for (let i = 0; i < L.n; i++) {
          const X = this.sx(L.x[i]); let Y = this.sy(s.yLog ? Math.max(L.y[i], s.y[0]) : L.y[i]);
          Y = Math.min(y1 + 40, Math.max(y0 - 40, Y));
          if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
        }
        g.stroke();
      });
      g.setLineDash([]); g.restore();
      // points and labels
      (s.points || []).forEach(P => {
        const X = this.sx(P.x), Y = clampY(P.y), r = P.r || 4;
        g.beginPath(); g.arc(X, Y, r + 2, 0, 6.2832); g.fillStyle = C.surface; g.fill();
        g.beginPath(); g.arc(X, Y, r, 0, 6.2832);
        if (P.ring) { g.lineWidth = 2; g.strokeStyle = P.color; g.stroke(); } else { g.fillStyle = P.color; g.fill(); }
        if (P.label) {
          g.font = (P.bold ? '600 12px ' : '11px ') + FONT.slice(5);
          g.fillStyle = P.bold ? C.ink : C.ink2;
          let pos = P.pos || 'tr'; const dx = r + 5;
          if (pos[0] === 't' && Y - 16 < y0) pos = 'b' + pos[1];
          if (pos[0] === 'b' && Y + 18 > y1) pos = 't' + pos[1];
          g.textAlign = pos[1] === 'l' ? 'right' : 'left'; g.textBaseline = pos[0] === 't' ? 'bottom' : pos[0] === 'b' ? 'top' : 'middle';
          let tx = X + (pos[1] === 'l' ? -dx : dx);
          const tw = g.measureText(P.label).width;
          if (g.textAlign === 'left' && tx + tw > x1) { g.textAlign = 'right'; tx = X - dx; }
          if (g.textAlign === 'right' && tx - tw < x0) { g.textAlign = 'left'; tx = X + dx; }
          g.fillText(P.label, tx, Y + (pos[0] === 't' ? -(r + 1) : pos[0] === 'b' ? r + 1 : 0));
          g.font = FONT;
        }
      });
      (s.notes || []).forEach(nt => { g.fillStyle = C.muted; g.textAlign = nt.align || 'left'; g.textBaseline = nt.base || 'bottom'; g.fillText(nt.text, nt.right ? x1 - 5 : x0 + 5, nt.top ? y0 + 4 : y1 - 5); });
    }
  }

  // ------------------------------------------------------------------ simulation state
  let P = S.makeCell(null, cellId);
  let A = null, B = null;          // CC-CV run, governor run
  let sweep = null, safe = null;   // CC-CV trade-off curve, fastest in-limits CC-CV
  let cursor = null;               // scrub time [min]
  let xmax = 1;
  const CNAME = { 0: 'Maximum current', 1: 'Plating margin', 2: 'Temperature', 3: 'Electrolyte depletion', 4: 'Cathode potential', 5: 'Anode saturation', 6: 'Voltage (CV phase)' };
  const CSHORT = { 0: 'Max current', 1: 'Plating', 2: 'Temperature', 3: 'Electrolyte', 4: 'Cathode', 5: 'Anode', 6: 'CV' };
  const CVAR = { 0: '--c-imax', 1: '--c-plate', 2: '--c-temp', 3: '--c-ce', 4: '--c-cath', 5: '--c-cath', 6: '--c-volt' };

  // time-series charts
  const TS = [
    { id: 'I', title: 'Charging current', unit: 'C-rate', dec: 2, val: (R, i) => R.I[i] / P.Qcell,
      dom: (lo, hi) => [0, Math.max(hi, 0.5) * 1.1] },
    { id: 'V', title: 'Terminal voltage', unit: 'V', dec: 3, val: (R, i) => R.V[i],
      hl: () => [{ y: p.Vmax, label: 'CC-CV limit ' + p.Vmax.toFixed(2) + ' V' }] },
    { id: 'soc', title: 'State of charge', unit: '%', dec: 1, val: (R, i) => R.soc[i] * 100, dom: () => [0, 100],
      hl: () => [{ y: p.socT, label: 'target' }] },
    { id: 'eta', title: 'Plating overpotential', unit: 'mV, anode | separator', dec: 1, val: (R, i) => R.etaPl[i] * 1e3, clamp: [-60, 160],
      hl: () => [{ y: p.etaMin, label: 'governor limit' }],
      bands: d => d[0] < 0 ? [{ y0: d[0], y1: 0, label: 'lithium plating' }] : [] },
    { id: 'T', title: 'Cell temperature', unit: '°C', dec: 1, val: (R, i) => R.T[i] - K,
      hl: () => [{ y: p.Tmax, label: 'governor limit' }],
      bands: d => d[1] > p.Tmax ? [{ y0: p.Tmax, y1: d[1], label: 'over limit', top: true }] : [] },
    { id: 'loss', title: 'Capacity lost this charge', unit: 'mAh, SEI + plating', dec: 3, val: (R, i) => (R.Qsei[i] + R.Qpl[i]) * 1e3,
      dom: (lo, hi) => [0, Math.max(hi, 0.05) * 1.12] },
    { id: 'th', title: 'Anode stoichiometry', unit: 'solid: surface, dashed: bulk', dec: 3, val: (R, i) => R.thssN[i],
      extra: (R, i) => R.thbN[i], dom: () => [0, 1] },
    { id: 'ce', title: 'Electrolyte at anode collector', unit: 'mol/m³', dec: 0, val: (R, i) => R.ceMin[i],
      dom: (lo, hi) => [0, Math.max(hi, 1000) * 1.06], hl: () => [{ y: 100, label: 'governor limit' }] },
    { id: 'phip', title: 'Cathode interfacial potential', unit: 'V vs Li/Li⁺', dec: 3, val: (R, i) => R.PhiP[i],
      hl: () => [{ y: P.PhiPmax, label: 'governor limit' }] },
  ];
  function figure(parent, title, unit, readout) {
    const f = el('figure', 'card'), cap = el('figcaption');
    cap.append(el('span', 'ft', title), el('span', 'fu', unit));
    let ro = null;
    if (readout) {
      ro = el('span', 'ro');
      const a = el('span'), b = el('span');
      a.append(el('i', 'key cccv'), el('b')); b.append(el('i', 'key rg'), el('b'));
      ro.append(a, b); cap.append(ro);
    }
    const plot = el('div', 'plot'); f.append(cap, plot); parent.append(f);
    return { f, plot, ro };
  }
  const hover = x => setCursor(x);
  TS.forEach(c => {
    const fg = figure($('#charts'), c.title, c.unit, true);
    c.ro = fg.ro; c.plot = new Plot(fg.plot, { onHover: hover });
  });
  // snapshot (spatial profile) charts
  const SNAP = [
    { id: 'pn', title: 'Anode particle', unit: 'stoichiometry vs r/R' },
    { id: 'pp', title: 'Cathode particle', unit: 'stoichiometry vs r/R' },
    { id: 'ce', title: 'Electrolyte', unit: 'mol/m³ vs x [µm]' },
  ];
  SNAP.forEach(c => { const fg = figure($('#snapgrid'), c.title, c.unit, false); fg.f.className = ''; c.plot = new Plot(fg.plot, { margin: { l: 40 } }); });
  const paretoPlot = new Plot($('#pareto-plot'), { margin: { l: 44, r: 16, t: 10, b: 24 } });

  // KPI tiles
  const KPI = [
    { id: 'time', label: 'Charge time' }, { id: 'loss', label: 'Capacity lost' },
    { id: 'eta', label: 'Lowest plating overpotential' }, { id: 'T', label: 'Peak temperature' },
  ];
  KPI.forEach(k => {
    const t = el('div', 'kpi card'), kl = el('div', 'kl'); k.note = el('span');
    kl.append(document.createTextNode(k.label), k.note); t.append(kl);
    ['a', 'b'].forEach(w => {
      const r = el('div', 'kr ' + w); k['v' + w] = el('span', 'kv'); k['s' + w] = el('span', 'ks');
      r.append(el('i', 'key ' + (w === 'a' ? 'cccv' : 'rg')), el('span', 'kn', w === 'a' ? 'CC-CV' : 'Governor'), k['v' + w], k['s' + w]);
      t.append(r);
    });
    k.d = el('div', 'kd'); t.append(k.d); $('#kpis').append(t);
  });
  function kv(node, num, unit) { node.textContent = ''; node.append(document.createTextNode(num), el('small', null, unit)); }

  // ------------------------------------------------------------------ helpers
  const mins = s => (s / 60).toFixed(1);
  const mAh = q => { const v = q * 1e3; return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); };
  const pct = f => Math.abs(f * 100).toFixed(Math.abs(f) < 0.1 ? 1 : 0) + '%';
  function fewer(a, b) {   // "b is ... than a", for a quantity where lower is better
    if (b <= 0 || a <= 0) return '';
    const r = a / b;
    return r >= 100 ? 'over 100× less' : r >= 2 ? r.toFixed(r >= 10 ? 0 : 1) + '× less' : pct((a - b) / a) + ' less';
  }
  function idxAt(R, tm) {
    const t = tm * 60; let lo = 0, hi = R.n - 1;
    if (t >= R.t[hi]) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R.t[mid] <= t) lo = mid; else hi = mid; }
    return (t - R.t[lo] < R.t[hi] - t) ? lo : hi;
  }
  function prep(R) {
    R.tm = new Float64Array(R.n); for (let i = 0; i < R.n; i++) R.tm[i] = R.t[i] / 60;
    R.y = {}; R.y2 = {};
    TS.forEach(c => {
      const y = new Float64Array(R.n); for (let i = 0; i < R.n; i++) y[i] = c.val(R, i); R.y[c.id] = y;
      if (c.extra) { const e = new Float64Array(R.n); for (let i = 0; i < R.n; i++) e[i] = c.extra(R, i); R.y2[c.id] = e; }
    });
    // skip the rest sample at t = 0 for the plotted lines (index 0 is the pre-charge rest state)
    let ceMax = 0; for (let i = 0; i < R.n; i++) if (R.ceMax[i] > ceMax) ceMax = R.ceMax[i];
    R.ceTop = ceMax;
  }
  function violations(R) {     // what the CC-CV run does that the governor's limits forbid
    const v = [];
    if (R.tPlating > 0) v.push('plating lithium for ' + mins(R.tPlating) + ' min');
    if (R.Tpeak > p.Tmax + K + 0.05) v.push('running ' + (R.Tpeak - K - p.Tmax).toFixed(1) + ' °C over the temperature limit');
    if (R.depleted) v.push('depleting the electrolyte');
    return v;
  }
  const join = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // ------------------------------------------------------------------ drawing
  function drawTS() {
    const x = [0, xmax];
    TS.forEach(c => {
      let lo = Infinity, hi = -Infinity;
      [A, B].forEach(R => { const y = R.y[c.id]; for (let i = 1; i < R.n; i++) { if (y[i] < lo) lo = y[i]; if (y[i] > hi) hi = y[i]; } });
      const hl = c.hl ? c.hl() : [];
      let dom;
      if (c.dom) dom = c.dom(lo, hi);
      else {
        hl.forEach(l => { if (l.y < lo) lo = l.y; if (l.y > hi) hi = l.y; });
        if (c.clamp) { lo = Math.max(lo, c.clamp[0]); hi = Math.min(hi, c.clamp[1]); if (c.id === 'eta') lo = Math.min(lo, -5); }
        const pad = Math.max(hi - lo, 1e-6) * 0.09; dom = [lo - pad, hi + pad];
      }
      const lines = [];
      [[A, C.cccv], [B, C.rg]].forEach(([R, col]) => {
        if (c.extra) lines.push({ x: R.tm.subarray(1), y: R.y2[c.id].subarray(1), n: R.n - 1, color: col, width: 1.5, dash: [4, 3] });
        lines.push({ x: R.tm.subarray(1), y: R.y[c.id].subarray(1), n: R.n - 1, color: col });
      });
      const points = [[A, C.cccv], [B, C.rg]].map(([R, col]) => ({ x: R.tm[R.n - 1], y: Math.min(dom[1], Math.max(dom[0], R.y[c.id][R.n - 1])), color: col, r: 3 }));
      c.plot.set({ x, y: dom, xUnit: 'min', lines, points, hlines: hl, bands: c.bands ? c.bands(dom) : [] });
    });
  }
  function drawCursor() {
    const ia = idxAt(A, cursor), ib = idxAt(B, cursor);
    TS.forEach(c => {
      c.plot.setHair(cursor);
      const sa = c.ro.children[0], sb = c.ro.children[1];
      sa.lastChild.textContent = A.y[c.id][ia].toFixed(c.dec); sb.lastChild.textContent = B.y[c.id][ib].toFixed(c.dec);
      sa.className = cursor * 60 > A.time + 1 ? 'done' : ''; sb.className = cursor * 60 > B.time + 1 ? 'done' : '';
    });
    $('#snap-t').textContent = cursor.toFixed(1) + ' min';
    $('#scrub').value = Math.round(cursor / xmax * 1000);
    drawSnap(ia, ib);
  }
  function setCursor(x) { cursor = Math.min(xmax, Math.max(0, x)); if (A) drawCursor(); }
  function drawSnap(ia, ib) {
    const Nr = P.Nr, runs = [[A, ia, C.cccv], [B, ib, C.rg]];
    const rr = new Float64Array(Nr + 1); for (let i = 0; i < Nr; i++) rr[i] = (i + 0.5) / Nr; rr[Nr] = 1;
    function particle(off, cmax, surfKey) {
      return runs.map(([R, i, col]) => {
        const y = new Float64Array(Nr + 1), base = i * P.nx + off;
        for (let k = 0; k < Nr; k++) y[k] = R.X[base + k] / cmax;
        y[Nr] = R[surfKey][i];
        return { x: rr, y, n: Nr + 1, color: col };
      });
    }
    const ends = L => L.map(l => ({ x: 1, y: l.y[Nr], color: l.color, r: 3 }));
    const ln = particle(P.iN, P.n.cmax, 'thssN'), lp = particle(P.iP, P.p.cmax, 'thssP');
    SNAP[0].plot.set({ x: [0, 1], y: [0, 1], lines: ln, points: ends(ln), notes: [{ text: 'centre', top: false }, { text: 'surface', right: true, align: 'right' }] });
    SNAP[1].plot.set({ x: [0, 1], y: [0, 1], lines: lp, points: ends(lp), notes: [{ text: 'centre' }, { text: 'surface', right: true, align: 'right' }] });
    const xe = new Float64Array(P.Ne); for (let j = 0; j < P.Ne; j++) xe[j] = P.xc[j] * 1e6;
    const le = runs.map(([R, i, col]) => {
      const y = new Float64Array(P.Ne), base = i * P.nx + P.iE; for (let j = 0; j < P.Ne; j++) y[j] = R.X[base + j];
      return { x: xe, y, n: P.Ne, color: col };
    });
    const top = Math.max(1500, A.ceTop, B.ceTop) * 1.12, Ln = P.n.L * 1e6, Ls = P.s.L * 1e6, Lt = P.Ltot * 1e6;
    SNAP[2].plot.set({ x: [0, Lt], y: [0, top], lines: le, hlines: [{ y: 100, label: 'governor limit', below: false }],
      vbands: [{ x0: 0, x1: Ln, label: 'anode' }, { x0: Ln, x1: Ln + Ls, label: '' }, { x0: Ln + Ls, x1: Lt, label: 'cathode' }] });
  }

  function drawKPI() {
    const tgt = p.soc0 + ' → ' + p.socT + '%';
    const k = Object.fromEntries(KPI.map(q => [q.id, q]));
    const stop = R => R.reached ? '' : 'stopped at ' + (R.socEnd * 100).toFixed(1) + '% (current < C/20)';
    // time
    k.time.note.textContent = tgt;
    kv(k.time.va, mins(A.time), 'min'); kv(k.time.vb, mins(B.time), 'min');
    k.time.sa.textContent = stop(A); k.time.sb.textContent = stop(B);
    const dT = (B.time - A.time) / A.time;
    setDelta(k.time.d, dT, v => (v < 0 ? '▼ ' + pct(v) + ' faster' : '▲ ' + pct(v) + ' slower'));
    // loss
    k.loss.note.textContent = 'this charge';
    kv(k.loss.va, mAh(A.loss), 'mAh'); kv(k.loss.vb, mAh(B.loss), 'mAh');
    const split = R => 'SEI ' + mAh(R.lossSei) + ' + plating ' + mAh(R.lossPl);
    k.loss.sa.textContent = split(A); k.loss.sb.textContent = split(B);
    const dL = (B.loss - A.loss) / A.loss;
    setDelta(k.loss.d, dL, v => (v < 0 ? '▼ ' + fewer(A.loss, B.loss) : '▲ ' + pct(v) + ' more'));
    // plating overpotential
    k.eta.note.textContent = 'limit ' + cdef('etaMin').f(p.etaMin);
    const mv = R => (R.etaPlMin * 1e3 >= 0 ? '+' : '−') + Math.abs(R.etaPlMin * 1e3).toFixed(1);
    kv(k.eta.va, mv(A), 'mV'); kv(k.eta.vb, mv(B), 'mV');
    const pl = R => R.tPlating > 0 ? '⚠ plating for ' + mins(R.tPlating) + ' min' : 'no plating';
    k.eta.sa.textContent = pl(A); k.eta.sa.className = 'ks' + (A.tPlating > 0 ? ' bad' : '');
    k.eta.sb.textContent = pl(B); k.eta.sb.className = 'ks' + (B.tPlating > 0 ? ' bad' : '');
    k.eta.d.className = 'kd neutral';
    k.eta.d.textContent = A.tPlating > 0 && !B.tPlating ? 'Only the governor stays above 0 mV' : !A.tPlating && !B.tPlating ? 'Neither run plates lithium' : 'Below 0 mV, lithium plates';
    // temperature
    k.T.note.textContent = 'limit ' + p.Tmax + ' °C';
    kv(k.T.va, (A.Tpeak - K).toFixed(1), '°C'); kv(k.T.vb, (B.Tpeak - K).toFixed(1), '°C');
    const over = R => R.Tpeak - K > p.Tmax + 0.05;
    k.T.sa.textContent = over(A) ? '⚠ ' + (A.Tpeak - K - p.Tmax).toFixed(1) + ' °C over the limit' : 'within limit'; k.T.sa.className = 'ks' + (over(A) ? ' bad' : '');
    k.T.sb.textContent = over(B) ? '⚠ over the limit' : 'within limit'; k.T.sb.className = 'ks' + (over(B) ? ' bad' : '');
    k.T.d.className = 'kd neutral';
    k.T.d.textContent = 'Peak voltage ' + A.Vpeak.toFixed(2) + ' V vs ' + B.Vpeak.toFixed(2) + ' V';
  }
  function setDelta(node, v, f) {
    node.className = 'kd ' + (Math.abs(v) < 0.005 ? 'neutral' : v < 0 ? 'good' : 'bad');
    node.textContent = Math.abs(v) < 0.005 ? 'About the same' : f(v);
  }

  function drawVerdict() {
    const v1 = $('#v1'), v2 = $('#v2'), v3 = $('#v3'), tgt = p.socT + '%', rate = parseFloat(p.crate.toFixed(2)) + 'C CC-CV';
    const dT = (B.time - A.time) / A.time, dL = (B.loss - A.loss) / A.loss, viol = violations(A);
    let s;
    if (B.Ipeak <= 0) {
      s = 'The governor cannot charge: the temperature limit is at or below the cell temperature.';
    } else if (!A.reached || !B.reached) {
      s = 'Neither controller can reach ' + tgt + ' before the current tapers below C/20. The governor gets to ' + (B.socEnd * 100).toFixed(1) + '% in ' + mins(B.time) + ' min; ' + rate + ' gets to ' + (A.socEnd * 100).toFixed(1) + '% in ' + mins(A.time) + ' min.';
      if (A.reached !== B.reached) s = (B.reached ? 'Only the governor' : 'Only CC-CV') + ' reaches ' + tgt + ' before the current tapers below C/20.';
    } else if (dT < -0.005 && dL < -0.005) {
      s = 'The governor reaches ' + tgt + ' in ' + mins(B.time) + ' min, ' + pct(dT) + ' faster than ' + rate + ', and loses ' + fewer(A.loss, B.loss) + ' capacity' + (A.tPlating > 0 && !B.tPlating ? ' with no lithium plating in this model.' : '.');
    } else if (dT >= -0.005 && dL < -0.005) {
      s = 'The governor takes ' + mins(B.time) + ' min, ' + (dT < 0.005 ? 'about the same as ' : pct(dT) + ' longer than ') + rate + ', but loses ' + fewer(A.loss, B.loss) + ' capacity.' + (viol.length ? ' CC-CV only keeps up by ' + join(viol) + '.' : '');
    } else if (dT < -0.005) {
      s = 'The governor reaches ' + tgt + ' in ' + mins(B.time) + ' min, ' + pct(dT) + ' faster than ' + rate + ', at ' + (dL < 0.005 ? 'about the same capacity loss.' : (dL >= 1 ? (1 + dL).toFixed(1) + '× the' : pct(dL) + ' more') + ' capacity loss ' +
        (B.lossPl > 0.2 * B.lossSei ? '(its plating limit is loose enough to plate lithium).' : '(it runs warmer, so the SEI grows faster).'));
    } else {
      s = rate + ' finishes ' + pct(dT) + ' sooner here' + (viol.length ? ', but only by ' + join(viol) + '.' : ': at this rate it already sits inside every limit the governor enforces.');
    }
    v1.textContent = s;
    // equal-constraints comparison
    let t = '';
    if (safe && B.Ipeak > 0) {
      if (safe.none) t = 'No CC-CV rate down to 0.1C stays inside the same plating and temperature limits.';
      else if (safe.capped) t = 'CC-CV stays inside the same plating and temperature limits even at ' + UI.cHi + 'C.';
      else {
        const r = safe.time / B.time;
        t = 'The fastest CC-CV that stays inside the same plating and temperature limits is ' + safe.c.toFixed(2) + 'C, taking ' + mins(safe.time) + ' min' +
          (r > 1.03 ? ': the governor is ' + (r >= 1.5 ? r.toFixed(1) + '× faster' : pct(r - 1) + ' faster') + ' under equal constraints.' : ', about the same as the governor.');
      }
    }
    v2.textContent = t;
    const w = [];
    if (A.depleted) w.push('CC-CV fully depletes the electrolyte at the anode: the SPMe is outside its validity range there, so its plating figure is indicative only.');
    if (p.etaMin < 0) w.push('The plating limit is below 0 mV, so the governor is being allowed to plate lithium.');
    v3.textContent = w.join(' ');
  }

  function segs(R) {
    const out = [], tot = xmax * 60;
    for (let i = 1; i < R.n; i++) {
      const code = R.active[i], d = R.t[i] - R.t[i - 1], last = out[out.length - 1];
      if (last && last.code === code) last.d += d; else out.push({ code, d });
    }
    const m = [];   // fold slivers (< 1.5 % of the axis) into their neighbour
    out.forEach(s => {
      const last = m[m.length - 1];
      if (last && (last.code === s.code || s.d < 0.015 * tot)) last.d += s.d; else m.push({ code: s.code, d: s.d });
    });
    return m;
  }
  function drawStrips() {
    const tot = xmax * 60, share = {};
    [['#strip-a', A, true], ['#strip-b', B, false]].forEach(([sel, R, isA]) => {
      const host = $(sel); host.textContent = '';
      segs(R).forEach(s => {
        const i = el('i', 'c' + s.code), f = s.d / tot;
        i.style.width = (f * 100) + '%';
        const name = isA && s.code === 0 ? 'Constant current' : CNAME[s.code];
        i.title = name + ': ' + mins(s.d) + ' min';
        if (f > 0.13) i.textContent = isA && s.code === 0 ? 'CC' : CSHORT[s.code];
        host.append(i);
      });
      for (let i = 1; i < R.n; i++) { const c = R.active[i]; share[c] = share[c] || [0, 0]; share[c][isA ? 0 : 1] += R.t[i] - R.t[i - 1]; }
    });
    $('#strip-end').textContent = xmax.toFixed(0) + ' min';
    const leg = $('#sleg'); leg.textContent = '';
    const hd = el('div', 'hd'); hd.append(el('span'), el('span', null, 'Active limit, share of charge time'), el('span', 'pc', 'CC-CV'), el('span', 'pc', 'Governor')); leg.append(hd);
    [0, 6, 1, 2, 3, 4, 5].forEach(c => {
      if (!share[c]) return;
      const row = el('div'), sw = el('span', 'sw'); sw.style.background = 'var(' + CVAR[c] + ')';
      const f = (t, R) => t > 0 ? (100 * t / R.time).toFixed(0) + '%' : '–';
      const a = el('span', 'pc'), b = el('span', 'pc'); a.append(el('b', null, f(share[c][0], A))); b.append(el('b', null, f(share[c][1], B)));
      row.append(sw, el('span', null, CNAME[c]), a, b); leg.append(row);
    });
  }

  let paretoPts = [];
  function drawPareto() {
    const pts = [], cap = 1000;
    const sel = { c: p.crate, time: A.time, loss: A.loss };
    const hasSafe = safe && !safe.none && !safe.capped;
    let curve = (sweep || []).filter(q => Math.abs(q.c - p.crate) > 0.04 && !(hasSafe && Math.abs(q.c - safe.c) < 0.03)).concat([sel]);
    if (hasSafe) curve.push(safe);
    curve.sort((a, b) => a.c - b.c);
    const tx = q => q.time / 60, ly = q => Math.min(cap, q.loss * 1e3);
    let lo = Infinity, hi = 0, xm = 0;
    curve.concat([{ time: B.time, loss: B.loss }]).forEach(q => { lo = Math.min(lo, ly(q)); hi = Math.max(hi, ly(q)); xm = Math.max(xm, tx(q)); });
    const snap = (v, up) => { const d = Math.pow(10, Math.floor(Math.log10(v))), f = v / d, ks = [1, 2, 5, 10]; return (up ? ks.find(k => k >= f - 1e-9) : ks.slice().reverse().find(k => k <= f + 1e-9)) * d; };
    const dom = [snap(lo / 2.2, false), Math.min(cap, snap(hi * 1.5, true))];
    const line = { x: curve.map(tx), y: curve.map(ly), n: curve.length, color: C.cccv };
    paretoPts = [];
    const labelled = UI.labelled, xr = xm * 1.08, yr = Math.log(dom[1] / dom[0]);
    const near = (a, b) => Math.abs(tx(a) - tx(b)) / xr < 0.16 && Math.abs(Math.log(ly(a) / ly(b))) / yr < 0.14;
    curve.forEach(q => {
      if (q === sel || q === safe) return;
      const lab = labelled.some(v => Math.abs(v - q.c) < 0.01) && !near(q, sel) && !near(q, B) && !(hasSafe && near(q, safe)) ? q.c + 'C' : null;
      pts.push({ x: tx(q), y: ly(q), color: C.cccv, r: 2.5, label: lab, pos: 'tr' });
      paretoPts.push({ x: tx(q), y: ly(q), name: 'CC-CV at ' + q.c + 'C', q });
    });
    if (hasSafe) {
      pts.push({ x: tx(safe), y: ly(safe), color: C.cccv, r: 6, ring: true });
      paretoPts.push({ x: tx(safe), y: ly(safe), name: 'Fastest in-limits CC-CV, ' + safe.c.toFixed(2) + 'C', q: safe });
    }
    pts.push({ x: tx(sel), y: ly(sel), color: C.cccv, r: 6, label: 'CC-CV ' + cdef('crate').f(p.crate).replace(' ', ''), bold: true, pos: 'tr' });
    paretoPts.push({ x: tx(sel), y: ly(sel), name: 'CC-CV at ' + p.crate.toFixed(2) + 'C (selected)', q: sel });
    pts.push({ x: tx(B), y: ly(B), color: C.rg, r: 6, label: 'Governor', bold: true, pos: 'bl' });
    paretoPts.push({ x: tx(B), y: ly(B), name: 'Reference governor', q: B });
    paretoPlot.set({ x: [0, xm * 1.08], y: dom, yLog: true, xUnit: 'min', lines: [line], points: pts,
 });
  }
  (function paretoHover() {
    const host = $('#pareto-plot'), tip = $('#pareto-tip');
    host.addEventListener('pointermove', e => {
      if (!paretoPlot.spec) return;
      const r = host.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 28 * 28;
      paretoPts.forEach(q => { const dx = paretoPlot.sx(q.x) - mx, dy = paretoPlot.sy(q.y) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = q; } });
      if (!best) { tip.style.display = 'none'; return; }
      tip.textContent = ''; tip.append(el('b', null, mins(best.q.time) + ' min · ' + mAh(best.q.loss) + ' mAh'), el('div', null, best.name));
      tip.style.display = 'block';
      const px = paretoPlot.sx(best.x), py = paretoPlot.sy(best.y);
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, px + 12)) + 'px';
      tip.style.top = Math.max(4, py - tip.offsetHeight - 10) + 'px';
    });
    host.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  })();

  function drawTable() {
    const t = $('#tbl'); t.textContent = '';
    const head = el('tr'); ['Metric', 'CC-CV ' + p.crate.toFixed(2) + 'C', 'Reference governor'].forEach(h => head.append(el('th', null, h)));
    const th = el('thead'); th.append(head); t.append(th);
    const rows = [
      ['Charge time [min]', R => mins(R.time)],
      ['Final SOC [%]', R => (R.socEnd * 100).toFixed(1)],
      ['Capacity lost [mAh]', R => mAh(R.loss)],
      ['  to SEI growth [mAh]', R => mAh(R.lossSei)],
      ['  to lithium plating [mAh]', R => mAh(R.lossPl)],
      ['Lowest plating overpotential [mV]', R => (R.etaPlMin * 1e3).toFixed(1)],
      ['Time with η_pl < 0 [min]', R => mins(R.tPlating)],
      ['Peak temperature [°C]', R => (R.Tpeak - K).toFixed(1)],
      ['Peak terminal voltage [V]', R => R.Vpeak.toFixed(3)],
      ['Peak current [C]', R => (R.Ipeak / P.Qcell).toFixed(2)],
      ['Average current [C]', R => ((R.socEnd - p.soc0 / 100) * 3600 / R.time).toFixed(2)],
      ['Li conservation check: solid-phase drift [relative]', R => R.liSolidDrift.toExponential(1)],
      ['Li conservation check: electrolyte drift [relative]', R => R.liElyteDrift.toExponential(1)],
      ['Li conservation check: anode uptake vs. ∫I dt / F [relative]', R => R.liCoulombErr.toExponential(1)],
    ];
    const tb = el('tbody');
    rows.forEach(r => { const tr = el('tr'); tr.append(el('td', null, r[0]), el('td', null, r[1](A)), el('td', null, r[1](B))); tb.append(tr); });
    t.append(tb);
  }

  // ------------------------------------------------------------------ run loop
  let raf = 0, slowTimer = 0;
  function scenario() { return { soc0: p.soc0 / 100, socT: p.socT / 100, Tamb: p.Tamb + K, dt: 2 }; }
  function run() {
    raf = 0;
    P.h = p.h; P.hA = P.h * P.Asurf;
    const sc = scenario();
    A = S.simulate(P, sc, { type: 'cccv', Imax: p.crate * P.Qcell, Vmax: p.Vmax });
    B = S.simulate(P, sc, { type: 'rg', Imax: p.ImaxRG * P.Qcell, etaMin: p.etaMin / 1e3, Tmax: p.Tmax + K, horizon: 3 });
    prep(A); prep(B);
    const first = cursor == null, frac = first ? 0.35 : cursor / xmax;
    xmax = Math.max(A.time, B.time, 60) / 60 * 1.02;
    cursor = frac * xmax;
    drawAll();
    $('#pareto').classList.add('stale');
    clearTimeout(slowTimer); slowTimer = setTimeout(runSlow, 140);
  }
  function runSlow() {
    const sc = scenario();
    sweep = S.sweepCCCV(P, sc, p.Vmax, UI.sweep);
    safe = S.safeCCCV(P, sc, p.Vmax, { etaMin: p.etaMin / 1e3, Tmax: p.Tmax + K }, UI.cHi) || { none: true };
    $('#pareto').classList.remove('stale');
    drawPareto(); drawVerdict();
  }
  function drawAll() { drawKPI(); drawVerdict(); drawStrips(); drawTS(); drawCursor(); drawPareto(); drawTable(); }
  function schedule() { clearTimeout(slowTimer); if (!raf) raf = requestAnimationFrame(run); }

  $('#scrub').addEventListener('input', e => setCursor(+e.target.value / 1000 * xmax));
  $('#csv').addEventListener('click', () => {
    const rows = ['controller,t_s,I_A,V_V,soc,eta_pl_V,T_degC,theta_surf_n,theta_surf_p,ce_anode_cc_mol_m3,phi_cathode_V,Q_sei_Ah,Q_plating_Ah,active_constraint'];
    [['cccv', A], ['governor', B]].forEach(([n, R]) => {
      for (let i = 0; i < R.n; i++) rows.push([n, R.t[i], R.I[i].toFixed(4), R.V[i].toFixed(5), R.soc[i].toFixed(5), R.etaPl[i].toFixed(5),
        (R.T[i] - K).toFixed(3), R.thssN[i].toFixed(5), R.thssP[i].toFixed(5), R.ceMin[i].toFixed(1), R.PhiP[i].toFixed(5),
        R.Qsei[i].toExponential(4), R.Qpl[i].toExponential(4), R.active[i]].join(','));
    });
    const a = el('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = 'fast_charge_trajectories_' + cellId + '.csv';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const retheme = () => { readColors(); if (A) drawAll(); };
  if (mq.addEventListener) mq.addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  readColors();
  setCell(cellId);
  run();
  window.__sim = { get A() { return A; }, get B() { return B; }, get sweep() { return sweep; }, get safe() { return safe; }, p,
                   get P() { return P; }, get cell() { return cellId; }, setCell: id => { setCell(id); schedule(); } };
})();

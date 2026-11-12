"""
Cross-check this repo's SPMe against PyBaMM (SPMe and DFN): the NMC cell with PyBaMM's Chen2020
parameter set, the LFP cell (cases named "LFP: ...") with its Prada2013 set.

    node tests/crosscheck_export.js > spme_cases.json
    python tests/crosscheck_pybamm.py spme_cases.json [out.png]

Needs: pip install pybamm matplotlib      (last run with pybamm 26.10)

Thermal cases use PyBaMM's lumped model with the "heat of mixing" option on, because this tool's heat
source I*(V - U_ocv(bulk)) includes the heat released by concentration gradients in the particles.
PyBaMM's default leaves that term out; the script also reports the temperature it gives.
"""
import json, sys
import numpy as np
import pybamm

data = json.load(open(sys.argv[1]))
png = sys.argv[2] if len(sys.argv) > 2 else None
pybamm.set_logging_level("ERROR")

def run(kind, case, mixing="true"):
    opts = {"thermal": "lumped", "heat of mixing": mixing} if case["thermal"] else {}
    model = (pybamm.lithium_ion.SPMe if kind == "SPMe" else pybamm.lithium_ion.DFN)(opts)
    pv = pybamm.ParameterValues("Prada2013" if case.get("cell") == "lfp" else "Chen2020")
    t = np.array(case["t"], float); I = np.array(case["I"], float)
    if np.ptp(I) == 0:
        cur = -I[0]                                              # PyBaMM: positive current = discharge
    else:                                                        # I[k] was held over (t[k-1], t[k]]: place it at the midpoint
        tm = np.concatenate([[0.0], 0.5 * (np.concatenate([[0.0], t[:-1]]) + t), [t[-1]]])
        Im = np.concatenate([[I[0]], I, [I[-1]]])
        cur = lambda tt: pybamm.Interpolant(tm, -Im, tt)
    pv.update({
        "Current function [A]": cur,
        "Initial concentration in negative electrode [mol.m-3]": case["csn0"],
        "Initial concentration in positive electrode [mol.m-3]": case["csp0"],
        "Ambient temperature [K]": case["Tamb"], "Initial temperature [K]": case["Tamb"],
        "Upper voltage cut-off [V]": 4.6, "Lower voltage cut-off [V]": 1.5,
    })
    if case.get("app"):      # reproduce the dashboard's configuration on top of Chen2020
        ap = case["app"]; arr = lambda E, T: pybamm.exp(E / pybamm.constants.R * (1 / 298.15 - 1 / T))
        De0, ka0 = pv["Electrolyte diffusivity [m2.s-1]"], pv["Electrolyte conductivity [S.m-1]"]
        scale = ap["Cth"] / RHOCP_VCELL
        pv.update({
            "Negative particle diffusivity [m2.s-1]": lambda sto, T: 3.3e-14 * arr(ap["EaDsN"], T),
            "Positive particle diffusivity [m2.s-1]": lambda sto, T: 4e-15 * arr(ap["EaDsP"], T),
            "Electrolyte diffusivity [m2.s-1]": lambda c, T: De0(c, T) * arr(ap["EaDe"], T),
            "Electrolyte conductivity [S.m-1]": lambda c, T: ka0(c, T) * arr(ap["EaKappa"], T),
            "Total heat transfer coefficient [W.m-2.K-1]": ap["h"],
        })
        for k in list(pv.keys()):
            if "specific heat capacity" in k: pv.update({k: pv[k] * scale})
    sim = pybamm.Simulation(model, parameter_values=pv)
    sol = sim.solve(np.concatenate([[0.0], t]))
    tt = t[t <= sol.t[-1]]
    Ln = pv["Negative electrode thickness [m]"]; L = Ln + pv["Separator thickness [m]"] + pv["Positive electrode thickness [m]"]
    out = {"n": len(tt), "V": sol["Voltage [V]"](tt)}
    out["thssN"] = sol["X-averaged negative particle surface concentration [mol.m-3]"](tt) / pv["Maximum concentration in negative electrode [mol.m-3]"]
    out["thssP"] = sol["X-averaged positive particle surface concentration [mol.m-3]"](tt) / pv["Maximum concentration in positive electrode [mol.m-3]"]
    ce = sol["Electrolyte concentration [mol.m-3]"]
    out["ce0"] = np.array([float(ce(t=ti, x=0.0)) for ti in tt]); out["ceL"] = np.array([float(ce(t=ti, x=L)) for ti in tt])
    out["T"] = sol["Volume-averaged cell temperature [K]"](tt)
    if kind == "DFN":   # phi_s - phi_e at the anode | separator interface: the plating overpotential (U_pl = 0)
        dphi = sol["Negative electrode surface potential difference [V]"]
        out["etaPl"] = np.array([float(dphi(t=ti, x=Ln)) for ti in tt])
    return out

# PyBaMM's lumped heat capacity for Chen2020: thickness-weighted rho*cp times the cell volume [J/K]
RHOCP_VCELL = (12 * 8960 * 385 + 85.2 * 1657 * 700 + 12 * 397 * 700 + 75.6 * 3262 * 700 + 16 * 2700 * 897) / 200.8 * 2.42e-5

def err(a, b, n, scale=1.0):
    d = (np.asarray(a[:n]) - np.asarray(b[:n])) * scale
    return np.sqrt(np.mean(d ** 2)), np.max(np.abs(d))
f = lambda e: f"{e[0]:6.2f} /{e[1]:7.2f}"

print("pybamm", pybamm.__version__)
keep = {}
print("\nRMS / max difference between this tool and PyBaMM over each charge (10 % to 80 % SOC, or until 4.45 V)\n")
print(f"{'case':40s} {'min':>5s} | {'V vs SPMe [mV]':>15s} {'V vs DFN [mV]':>15s} {'(SPMe vs DFN)':>15s} | {'anode th_s vs SPMe':>18s} | {'c_e(0) vs SPMe':>15s} {'c_e(0) vs DFN':>15s} | {'T vs SPMe [K]':>14s} {'T vs DFN [K]':>14s}")
for case in data["cases"]:
    spme, dfn = run("SPMe", case), run("DFN", case)
    n = min(spme["n"], dfn["n"], len(case["t"])); keep[case["name"]] = (case, spme, dfn, n)
    th = err(case["thssN"], spme["thssN"], n)
    Tcols = f"{f(err(case['T'], spme['T'], n)):>14s} {f(err(case['T'], dfn['T'], n)):>14s}" if case["thermal"] else f"{'-':>14s} {'-':>14s}"
    print(f"{case['name']:40s} {case['t'][n-1]/60:5.1f} | {f(err(case['V'], spme['V'], n, 1e3)):>15s} {f(err(case['V'], dfn['V'], n, 1e3)):>15s} {f(err(spme['V'], dfn['V'], n, 1e3)):>15s} | "
          f"{th[0]:8.5f}/{th[1]:8.5f} | {f(err(case['ce0'], spme['ce0'], n)):>15s} {f(err(case['ce0'], dfn['ce0'], n)):>15s} | {Tcols}")

print("\nPlating overpotential at the anode | separator interface: this tool (SPMe-based estimate) against PyBaMM's DFN\n")
print(f"{'case':40s} | {'RMS/max diff [mV]':>18s} | {'min, this tool':>14s} {'min, DFN':>10s} | {'time < 0, this tool':>19s} {'time < 0, DFN':>14s} | {'first < 0, this tool':>20s} {'first < 0, DFN':>15s}")
for name, (case, spme, dfn, n) in keep.items():
    t = np.array(case["t"][:n]); dt = np.diff(np.concatenate([[0.0], t])); a = np.array(case["etaPl"][:n]) * 1e3; b = dfn["etaPl"][:n] * 1e3
    first = lambda e: f"{t[np.argmax(e < 0)]/60:.1f} min" if (e < 0).any() else "never"
    print(f"{name:40s} | {f(err(a, b, n)):>18s} | {a.min():11.1f} mV {b.min():7.1f} mV | {dt[a < 0].sum()/60:15.1f} min {dt[b < 0].sum()/60:10.1f} min | {first(a):>20s} {first(b):>15s}")

print("\nEffect of PyBaMM's heat-of-mixing option on the thermal cases (final temperature, deg C)")
for name, (case, spme, dfn, n) in keep.items():
    if not case["thermal"]: continue
    d0 = run("DFN", case, mixing="false")
    print(f"{name:40s} this tool {case['T'][n-1]-273.15:6.2f} | DFN with heat of mixing {dfn['T'][n-1]-273.15:6.2f} | DFN default (no heat of mixing) {d0['T'][min(n, d0['n'])-1]-273.15:6.2f}")

if png:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    names = ["CC 1C, isothermal 25 C", "CC 1.5C, lumped thermal 25 C", "dashboard default: governor, 5 mV margin", "dashboard default: CC-CV 1C"]
    fig, ax = plt.subplots(5, 4, figsize=(17, 13.5), sharex="col")
    for j, nm in enumerate(names):
        case, spme, dfn, n = keep[nm]; tm = np.array(case["t"][:n]) / 60
        def tri(a, key, scale=1.0, off=0.0, withspme=True):
            a.plot(tm, (np.array(dfn[key][:n]) - off) * scale, color="0.6", lw=3.2, label="PyBaMM DFN")
            if withspme: a.plot(tm, (np.array(spme[key][:n]) - off) * scale, color="#1baf7a", lw=1.6, ls="--", label="PyBaMM SPMe")
            a.plot(tm, (np.array(case[key][:n]) - off) * scale, color="#2a78d6", lw=1.4, label="this tool")
        ax[0, j].plot(tm, np.array(case["I"][:n]) / 5.0903, color="0.2", lw=1.2); ax[0, j].set_ylabel("current [C-rate]"); ax[0, j].set_title(nm, fontsize=10); ax[0, j].set_ylim(0, 3.2)
        tri(ax[1, j], "V"); ax[1, j].set_ylabel("voltage [V]")
        tri(ax[2, j], "etaPl", 1e3, withspme=False); ax[2, j].set_ylabel("plating overpotential [mV]"); ax[2, j].set_ylim(-60, 160); ax[2, j].axhline(0, color="0.3", lw=0.6)
        tri(ax[3, j], "ce0"); ax[3, j].set_ylabel("c_e at anode collector [mol/m³]")
        tri(ax[4, j], "T", off=273.15); ax[4, j].set_ylabel("temperature [°C]"); ax[4, j].set_xlabel("time [min]")
    ax[1, 0].legend(frameon=False)
    fig.tight_layout(); fig.savefig(png, dpi=100)
    print("\nwrote", png)

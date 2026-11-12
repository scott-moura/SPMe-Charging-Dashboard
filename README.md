# Fast-Charging Simulator

An interactive, in-browser comparison of two ways to fast-charge a lithium-ion cell:

- **CC-CV** — constant current, then constant voltage.
- **Reference governor** — at every step, applies the largest current for which a model
  predicts that the cell's internal states stay inside their limits (plating overpotential,
  temperature, electrolyte depletion, cathode potential).

The plant is a single particle model with electrolyte (SPMe), a lumped thermal model, and
SEI-growth + lithium-plating aging, all solved live in the page in plain JavaScript (no server,
no libraries). Two cells are built in and can be switched at the top of the controls:

- **NMC811 / graphite-SiOx, 5 Ah** (LG M50 21700; Chen et al. 2020)
- **LiFePO4 / graphite, 2.3 Ah** (A123 ANR26650M1; Prada et al. 2013 as tabulated in PyBaMM)

Sliders set the plating
overpotential limit, temperature limit, initial and target SOC, ambient temperature, cooling,
and the CC-CV rate and voltage.

**Live version:** <https://scott-moura.github.io/SPMe-Charging-Dashboard/>

## Run it locally

No build step and no dependencies. Serve the folder and open it:

```bash
python3 -m http.server 8791
```

then visit <http://localhost:8791>. Opening `index.html` directly from disk also works.

## Files

| File | Contents |
|---|---|
| `spme.js` | SPMe + thermal + aging model, both parameter sets, CC-CV and reference-governor controllers. Runs in the browser and in Node (`require('./spme.js')`; `makeCell(overrides, 'nmc' \| 'lfp')`). |
| `app.js` | Sliders, plots, trade-off chart, state snapshots, CSV export. |
| `index.html` | Page layout, styles, and the "Model and assumptions" notes. |

## Verify lithium conservation

```bash
node tests/conservation.js
```

With side reactions off, total lithium in the solid phase and in the electrolyte each stay
constant to floating-point round-off (relative drift below 1e-12) for constant-current,
pulsed, sinusoidal, discharge and closed-loop inputs, including cases that deplete the electrolyte.
The test runs every case for both cells.

## Cross-check against PyBaMM

```bash
pip install pybamm matplotlib
node tests/crosscheck_export.js > spme_cases.json
python tests/crosscheck_pybamm.py spme_cases.json crosscheck.png
```

Runs matched constant-current charges, and replays of each controller's current profile, in PyBaMM's
SPMe and DFN: the NMC cell against the Chen2020 parameter set, the LFP cell against Prada2013.
Summary for the NMC cell (PyBaMM 26.10):

- Against PyBaMM's SPMe (the same model class): voltage within 0.4-4 mV RMS up to 1.5C, anode surface
  stoichiometry within 0.003, temperature within about 1 K.
- Against PyBaMM's DFN: voltage within 3-16 mV RMS, the same as PyBaMM's own SPMe-to-DFN gap.
- Temperature agrees only when PyBaMM's "heat of mixing" option is on; its default omits that heat
  and runs 3-15 K cooler.
- **Plating overpotential is the weak point.** The SPMe-based estimate differs from the DFN by about
  10 mV RMS and reads up to about 13 mV high mid-charge. Replayed in the DFN, the governor with a 5 mV
  margin dips to -8 mV; with a 15 mV margin it stays positive. See the "Model and assumptions" card.

Summary for the LFP cell (isothermal; PyBaMM's Prada2013 set has no thermal parameters):

- Voltage within 3-13 mV RMS of both PyBaMM models. Nearly all of it is a start-up transient in the
  anode surface concentration that both codes resolve coarsely with 20 radial points (they agree
  within 2 mV when both use 80); under 1 mV after the first 2 minutes at 1C.
- Lowest plating overpotential within 0.5 mV of the DFN up to 2C and in the governor replay
  (+5.0 mV here, +5.2 mV in the DFN). The electrodes are thin, so the single-particle estimate holds.

## Model provenance and caveats

Full equation-by-equation and parameter-by-parameter sourcing is in the "Model and assumptions"
card at the bottom of the page. In short:

- Cell parameters and open-circuit potentials: LG M50 21700 (NMC811 / graphite-SiOx),
  Chen et al., *J. Electrochem. Soc.* 167 (2020) 080534; electrolyte from Nyman et al. (2008).
  Temperature dependence and SEI constants: O'Kane et al., *Phys. Chem. Chem. Phys.* 24 (2022) 7909.
  Values were checked against the PyBaMM v24.1 parameter files `Chen2020.py` and `OKane2022.py`.
- LFP cell: A123 ANR26650M1. Geometry, transport, kinetics and open-circuit potentials are those of
  PyBaMM's `Prada2013.py` (PyBaMM 26.10), which attributes them to Prada et al.,
  *J. Electrochem. Soc.* 160 (2013) A616 and borrows the graphite OCP and kinetics from Chen 2020,
  the LFP OCP from Afshar et al. (arXiv:1709.03970) and the LFP kinetics from Kashkooli et al. (2017).
  Heat capacity, surface area and the activation energies of solid and electrolyte transport are from
  Prada et al., *J. Electrochem. Soc.* 159 (2012) A1508 (same cell). The 2013 paper is paywalled and
  was not read; the PyBaMM values were not checked against it. SEI and plating constants are carried
  over from the NMC cell.
- For the LFP set the anode is strongly diffusion-limited: the model plates above about 1.5C at 25 C,
  although the manufacturer lists a 10 A (4.3C) fast charge. Treat LFP plating results as comparative.
- Model structure: SPMe after Moura et al. (2017) and Marquis et al. (2019); governor after
  Perez, Shahmohammadhamedani and Moura (2015).
- **Assumed, not sourced:** the lithium-plating rate constants, the lumped heat capacity, and the
  governor's secondary limits. The SEI constants are generic rather than fitted to this cell.
  Treat capacity-loss numbers as comparisons between controllers, not lifetime predictions.
- The governor has perfect state knowledge; there is no observer or model-mismatch margin.
- If the electrolyte fully depletes (very high CC rates, or cold), the SPMe is outside its
  validity range. The page flags this.

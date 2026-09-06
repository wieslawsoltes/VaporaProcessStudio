# Vapora Process Studio

[Open the web application](https://wieslawsoltes.github.io/VaporaProcessStudio/) · [Deployment instructions](docs/DEPLOYMENT.md)

A dependency-free process-flowsheet editor and steady-state simulator built with plain HTML, CSS, JavaScript, and a WebGPU renderer with a functional Canvas 2D fallback.

The numerical engine performs actual material and energy balances, ideal-mixture phase equilibrium, unit-operation calculations, recycle convergence, and sensitivity studies in a dedicated Worker. Geometry is separate from the semantic process graph.

## Run locally

Node.js 20 or later is sufficient; no package installation is required.

```sh
git clone https://github.com/wieslawsoltes/VaporaProcessStudio.git
cd VaporaProcessStudio
npm start
```

Open http://localhost:4173. Use localhost or HTTPS for WebGPU; the status bar reports the actual rendering backend.

```sh
npm test          # 54 engine and model tests
npm run validate  # 11 analytical/conservation checks and generated reports
npm run build     # Generate the portable Vapora-Process-Studio.html
```

Generated screenshots and the standalone bundle are build outputs, not runtime dependencies. The multi-file application uses native ES modules and should be served rather than opened through file://.

## Working features

- Editable flowsheets with typed material/energy ports, equipment placement, snapping, pan/zoom, specifications, undo/redo, and project persistence.
- Feed/product boundaries, mixers, splitters, heaters, coolers, liquid pumps, valves, TP/PH flash separators, explicit recycle loops, and energy coupling.
- Component selection, unit conversion, stream/phase reports, balance residuals, diagnostics, CSV/JSON export, and independently computed sensitivity points.
- IDEAL-RAOULT and IDEAL-GAS property methods with documented equations, component data, assumptions, validity ranges, and explicit convergence failures.

The default benzene/toluene recovery process is calculated on startup. Select **F-201**, change **95 °C** to **96 °C**, apply the specification, and run again to inspect the changed phase split and downstream results.

## Model and validation boundary

This is a bounded ideal-mixture simulator, not Aspen Plus feature parity or a certified engineering design tool. Heat capacities, liquid densities, and latent-heat anchors are engineering approximations. Small residuals establish numerical closure, not real-plant predictive accuracy. There is no PR/SRK, NRTL/UNIQUAC, electrolyte model, reaction chemistry, distillation column, dynamics, or native Aspen file compatibility.

The delivered validation includes 54 passing engine/model tests, 11 passing numerical checks, and 22 browser integration checks. Browser integration exercised Canvas 2D and a real solver Worker; the WebGPU path was not hardware-validated in the delivery environment.

## Documentation

- [Thermodynamics and sign conventions](docs/THERMODYNAMICS.md)
- [Component coefficients and approximation constants](docs/COMPONENT-DATA.md)
- [Architecture and extension points](docs/ARCHITECTURE.md)
- [Calculated validation report](docs/VALIDATION.md)
- [Browser validation report](docs/browser-validation.json)
- [GitHub Pages publication and updates](docs/DEPLOYMENT.md)

Run the optional browser suite with Python and Playwright:

```sh
python -m pip install playwright
python -m playwright install chromium
npm run build
python tests/browser-smoke.py
```

Original application code is MIT licensed. Source-data and third-party marks retain their respective attribution. There is no affiliation with, or endorsement by, AspenTech or NIST.

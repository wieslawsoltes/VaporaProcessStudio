# Thermodynamic and numerical specification

## 1. Basis, units, and state

Internal quantities use mol/s, kelvin, pascals of absolute pressure, J/mol, watts, kg/mol, and kg/m³. A material state carries overall composition `z`, phase compositions `x` and `y`, total molar flow `F`, temperature `T`, pressure `P`, and molar vapor fraction `beta`. Extensive flow quantities are derived from that state; they are not independently user-edited degrees of freedom.

Display conversion is affine: `SI = displayed × scale + offset`. Dimension identifiers prevent pressure-to-power and other category errors. Celsius and Fahrenheit offsets apply only to absolute temperatures. The currently exposed temperature specifications are absolute temperatures, not temperature differences. Positive heat and positive shaft power mean energy **into material**.

The computational envelope is 200 K to the smaller of 600 K or the lowest selected critical-temperature guard minus 0.5 K. IDEAL-GAS extends the numerical upper bound to 1000 K. Pressure must be 1000–10,000,000 Pa. These are numerical guardrails, **not** validated physical ranges. Published Antoine intervals are substantially narrower for some species.

## 2. Vapor pressure and ideal VLE

For each component:

```text
log10(Psat_i / bar) = A_i − B_i / (T + C_i)
Psat_i [Pa] = 100000 × 10^(A_i − B_i/(T+C_i))
K_i = Psat_i / P
y_i = K_i x_i
```

This is Raoult's law with ideal liquid and vapor phases: activity and fugacity coefficients are one. Poynting corrections are not applied to equilibrium. The ideal-mixture treatment follows the standard ideal limit described in the IDAES property-model documentation; this application does not import or reproduce an IDAES solver implementation.

For a TP flash, the Rachford–Rice scalar equation is solved on `0 ≤ beta ≤ 1`:

```text
r(beta) = Σ z_i (K_i−1) / (1 + beta(K_i−1)) = 0
x_i = z_i / (1 + beta(K_i−1))
y_i = K_i x_i
```

Endpoint signs determine a stable single-phase result under this model. A decreasing residual and a bracketed Newton update are used for a two-phase root. The derivative is

```text
dr/dbeta = −Σ z_i (K_i−1)^2 / (1 + beta(K_i−1))^2.
```

Single-phase states retain a normalized incipient composition for the absent phase, but reports display a dash for absent-phase composition. It must not be interpreted as an independently present material phase. Both present phase compositions and overall component balance are tested.

At pure-component saturation, TP alone does not determine phase amounts. The low-level API accepts a `betaHint`; the editor uses the default liquid endpoint and adds an explicit ambiguity warning. Use PH specification when quality must be resolved from enthalpy. The pure-component PH branch calculates the Antoine saturation temperature analytically, then applies the latent-heat lever rule. It does not try to bisect across a discontinuous single-phase enthalpy jump.

For a mixture, bubble and dew equations at a specified pressure are:

```text
Σ z_i Psat_i(Tbubble)/P = 1
Σ z_i P/Psat_i(Tdew) = 1
```

The low-level API exposes these equations. If a bracket cannot be found within the numerical domain, it reports an error rather than returning a clipped temperature.

IDEAL-GAS is a separate vapor-only method: `beta=1`, `y=z`, molar volume `R T/P`. It does not predict condensation or vapor–liquid equilibrium.

## 3. Explicit caloric approximation

Reference temperature is `Tref=298.15 K`; pressure reference is `Pref=101325 Pa`. The model takes constant liquid/vapor heat capacities, constant liquid density, and a vaporization-enthalpy anchor at the species' nominal normal boiling temperature:

```text
vL_i = MW_i / rhoL_i
hL_i(T,P) = CpL_i(T−Tref) + vL_i(P−Pref)
hV_i(T)   = CpL_i(Tb_i−Tref) + HvapB_i + CpV_i(T−Tb_i)

hL = Σ x_i hL_i
hV = Σ y_i hV_i
h  = (1−beta) hL + beta hV
H  = F h
```

The pressure enthalpy term is essential for the incompressible pump model: it prevents all reversible pressure work from being falsely interpreted as sensible heating. This remains an approximation; liquid thermal expansion, excess enthalpy, pressure-dependent heat capacity, residual gas enthalpy, and reaction enthalpy are absent.

The latent heat implied away from the boiling anchor is the difference of these two constant-Cp enthalpy curves. It is not a Watson correlation and is not fitted to the saturation curve. The chosen caloric model and Antoine equation are **not** derivatives of a common fundamental thermodynamic potential. Therefore, matching energy balances demonstrates internal equation closure, not thermodynamic consistency or prediction quality over arbitrary paths.

The PH solver finds `h(T,P,z)−htarget=0` with bracketed bisection, scaled residual checking, and a separate pure-component latent plateau. Its final absolute enthalpy discrepancy is checked before a state is returned. No unbracketed result is silently extrapolated beyond the numerical envelope.

Molar volume is `(1−beta) Σ x_i vL_i + beta R T/P`; reported density is overall molecular weight divided by that homogeneous phase-volume estimate. “Frozen-phase Cp” weights the two phase heat capacities without differentiating beta, x, or y. It is not a full equilibrium derivative or a transport-property model.

## 4. Unit-operation equations

Every nonboundary operation independently records component residuals and `Σ Hout − Σ Hin − Q − W`. Feed and product blocks define external boundaries rather than internal balance equations. For the whole flowsheet, the sign is `Σ Hfeed + Σ Q + Σ W − Σ Hproduct`.

| Operation | Equations and assumptions |
|---|---|
| Mixer | Add component molar and enthalpy flows. Pressure is the minimum inlet pressure. Resolve outlet by PH flash. No heat or shaft work; up to three inputs. |
| Splitter | Two outlets retain inlet intensive state and composition; `F1=fF`, `F2=(1−f)F`. This is a flow splitter, not a component separator. |
| Heater/cooler | `Pout=Pin−dP`. Temperature mode obtains outlet enthalpy and calculates Q. Duty mode resolves `hout=hin+Q/F` by PH flash. Heaters reject negative duty and coolers reject positive duty, apart from rounding tolerance. |
| Pump | Liquid-only incompressible model: `W=F vL(Pout−Pin)/eta`. Outlet enthalpy is `hin+W/F`; outlet equilibrium is resolved by PH. The pump may produce outlet flashing, but vapor in the inlet is rejected. No motor/mechanical efficiency, NPSH, cavitation, or pump curve. |
| Valve | Specified outlet pressure must not exceed inlet pressure. Isenthalpic PH flash; no shaft work, heat, valve coefficient, choking, or pressure-drop hydraulics. |
| Flash drum | Equilibrium TP or PH specification at pressure no higher than the inlet. `V=beta F`, `L=(1−beta)F`, phase-specific compositions and enthalpies. TP mode computes duty. PH mode consumes duty; Q=0 is adiabatic. No vessel sizing, holdup, or entrainment. |
| Recycle | Identity material operation whose outlet becomes an explicit tear in graph compilation. Converges component flows, H, and P. It does not manufacture a makeup stream. |

Zero-flow streams are allowed downstream. A nonzero imposed heat duty on zero material flow is rejected. Species may have zero fraction, but a feed's overall fractions must sum to one.

## 5. Energy stream convention

A numeric energy-stream value is positive when it supplies energy to its receiving operation. An equipment heat-export port carries **`−Qsource`**, and a pump shaft-output port carries **`−Wsource`**. Thus a cooler with negative Q exports a positive recovered-heat stream. A heater that needs external heat can export a negative signed demand to an energy sink for reporting.

An energy input replaces the receiving operation's configured heat duty and is valid only in Q/PH mode. Simultaneously consuming an energy stream and exporting that same unit's duty is rejected to avoid duplicating a utility link. Direct energy links participate in topological dependencies. Energy feedback loops have no tear formulation in this release and are rejected. Energy sources and sinks are utility boundaries, not additional heat-generating material operations.

A cooler connected to a heater transfers the computed duty perfectly. There is no finite-temperature-approach or exchanger-area feasibility check; a thermodynamically feasible amount of heat is not necessarily feasible heat integration.

## 6. Recycle iteration and diagnostics

Each explicit tear has an unknown vector `[n1,…,nNc,H,P]`. Zero component flow at the first feed's temperature/pressure initializes every tear. Each iteration walks a deterministic topological ordering of the remaining graph and obtains calculated return states. The infinity-norm residual uses denominator scales:

```text
component i: 1 mol/s  + max(|n_i,new|, |n_i,old|)
enthalpy:     100 W    + max(|Hnew|, |Hold|)
pressure:    1000 Pa  + max(|Pnew|, |Pold|)
```

Relaxed substitution is `xnext=x+omega(g(x)−x)`. Optional component-wise Wegstein acceleration estimates the last secant slope and bounds the extrapolation factor at four. It is attempted every third iteration, gated against residual growth, and falls back to relaxed substitution when an accelerated state is nonphysical. This is a safeguarded fixed-point method, not a guarantee of global nonlinear convergence.

The final reported tear stream is the state actually consumed by the downstream blocks in the final sweep, not an inconsistent overwritten candidate. The recycle block separately reports its actual-return versus consumed-tear imbalance. Convergence requires both the tear tolerance and the global balance acceptance check. The latter uses `max(1e−6,20×tearTolerance)` after scaling.

Nonconvergence is preserved in results and sensitivity rows. The chart never joins across failed or unaccepted points. Changing physical input invalidates prior results; a run that is cancelled or belongs to an old project revision is never accepted.

## 7. Property ranges and source provenance

[COMPONENT-DATA.md](COMPONENT-DATA.md) lists every coefficient and published interval. One fit per species avoids correlation-switch discontinuities. Out-of-interval evaluation is marked as extrapolation; strict mode rejects it. Above 5 bar, the ideal-model limitation produces an additional warning. Water/alcohol mixtures with multiple active components receive a nonideality warning. These warnings are not exhaustive physical validity tests.

Antoine coefficients and their temperature/pressure conventions are from the NIST Chemistry WebBook SRD 69 species records. Rounded heat capacities, densities, boiling/critical guards, and latent anchors are engineering assumptions. Sources and conceptual references:

- NIST Chemistry WebBook: https://webbook.nist.gov/chemistry/
- IDAES NIST property equations and units: https://idaes-pse.readthedocs.io/en/stable/explanations/components/property_package/general/pure/NIST.html
- IDAES ideal/activity-coefficient VLE formulation: https://idaes-pse.readthedocs.io/en/2.1.0/reference_guides/model_libraries/generic/property_models/activity_coefficient.html
- IDAES pressure-changer model context: https://idaes-pse.readthedocs.io/en/stable/reference_guides/model_libraries/generic/unit_models/pressure_changer.html

The shipped examples are not claimed to match any Aspen Plus, IDAES, or measured plant benchmark. Property accuracy must be established independently for a target engineering application.

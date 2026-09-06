# Component model constants

Pressure from the listed Antoine coefficients is in bar; temperature is in kelvin. The engine converts pressure to pascals. Only these single, continuous coefficient sets are used.

| Species | A | B | C | Published Antoine interval, K |
|---|---:|---:|---:|---|
| Benzene | 4.72583 | 1660.652 | -1.461 | 333.4–373.5 |
| Toluene | 4.07827 | 1343.943 | -53.773 | 308.52–384.66 |
| Water | 4.6543 | 1435.264 | -64.848 | 255.9–373 |
| Methanol | 5.20409 | 1581.341 | -33.5 | 288.1–356.83 |
| Ethanol | 5.24677 | 1598.673 | -46.424 | 292.77–366.63 |
| Acetone | 4.42448 | 1312.253 | -32.445 | 259.16–507.6 |
| n-Hexane | 4.00266 | 1171.53 | -48.784 | 286.18–342.69 |

## Rounded caloric and density assumptions

These constants are explicit **engineering approximations**, not a copied NIST caloric database. They must be replaced or regressed for higher-fidelity prediction.

| Species | MW, kg/mol | Cp liquid, J/mol K | Cp vapor, J/mol K | Tb anchor, K | ΔHvap anchor, J/mol | Liquid density, kg/m³ | Tc guard, K |
|---|---:|---:|---:|---:|---:|---:|---:|
| Benzene | 0.0781118 | 136.1 | 82.4 | 353.24 | 30720 | 874 | 562.02 |
| Toluene | 0.0921384 | 156 | 103.7 | 383.75 | 33180 | 867 | 591.75 |
| Water | 0.0180153 | 75.3 | 33.6 | 373.15 | 40650 | 997 | 647.1 |
| Methanol | 0.0320419 | 81.1 | 44 | 337.85 | 35210 | 792 | 512.6 |
| Ethanol | 0.0460684 | 112.4 | 65.2 | 351.44 | 38560 | 789 | 514 |
| Acetone | 0.0580791 | 125.5 | 75 | 329.22 | 29100 | 784 | 508.1 |
| n-Hexane | 0.0861754 | 198 | 143 | 341.88 | 28850 | 655 | 507.8 |

## Vapor-pressure source records

- Benzene, CAS 71-43-2: https://webbook.nist.gov/cgi/cbook.cgi?ID=C71432&Mask=4&Type=ANTOINE&Plot=on
- Toluene, CAS 108-88-3: https://webbook.nist.gov/cgi/cbook.cgi?ID=C108883&Mask=4&Type=ANTOINE&Plot=on
- Water, CAS 7732-18-5: https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Mask=4&Type=ANTOINE&Plot=on
- Methanol, CAS 67-56-1: https://webbook.nist.gov/cgi/cbook.cgi?ID=C67561&Mask=4&Type=ANTOINE&Plot=on
- Ethanol, CAS 64-17-5: https://webbook.nist.gov/cgi/cbook.cgi?ID=C64175&Mask=4&Type=ANTOINE&Plot=on
- Acetone, CAS 67-64-1: https://webbook.nist.gov/cgi/cbook.cgi?ID=C67641&Mask=4&Type=ANTOINE&Plot=on
- n-Hexane, CAS 110-54-3: https://webbook.nist.gov/cgi/cbook.cgi?ID=C110543&Mask=4&Type=ANTOINE&Plot=on

Sources: NIST Chemistry WebBook, Standard Reference Database 69. NIST's data-compilation attribution and terms remain applicable. This project does not claim NIST endorsement or ownership of the source database.

# Architecture and extension guide

## Semantic model, not a drawing-as-database

A project is a versioned JSON object with component IDs, property method, solver settings, display units, operation records, and stream records. Operations have stable IDs independent of editable tags and geometry. A stream references two typed semantic ports rather than two arbitrary drawing coordinates. Moving equipment cannot change the material graph or its calculated state.

Port descriptors specify direction, kind, side, and relative position. Each port accepts one connection. Mixers and splitters make multiple-material relationships explicit. Validation covers missing endpoints, incompatible material/energy ports, multiply connected ports, incomplete material topology, property methods, composition, solver settings, and project-size limits. Prototype-related JSON keys and reserved object-record identifiers are rejected. Project text is escaped before HTML insertion; it is never evaluated as code. CSV export neutralizes formula-like user text.

Undo/redo uses bounded before/after semantic snapshots. New divergent edits clear redo. Results are deliberately excluded from transaction history and invalidated after undo/redo rather than silently restoring stale calculated states. Geometry moves preserve the current result; topology and specification changes increment a physical revision.

The limits of 2,000 operations and 10,000 streams are import safety bounds, not performance guarantees. Input connection validation currently uses some linear scans and graph compilation is whole-model, not an incremental dependency compiler.

## Numerical dependency pipeline

`numerics.js` has no DOM dependencies. `thermo.js` uses only numerical utilities and component constants. `simulator.js` compiles typed dependencies and applies the unit-operation equations. Its exported synchronous functions run both in Node tests and inside the browser's dedicated Worker.

Topological compilation removes material edges leaving explicit Recycle blocks. Residual material or energy cycles fail before evaluation. Unrelated branches and multiple tears are supported. The current sequential modular formulation solves fully specified unit operations; there is no equation-oriented simultaneous Newton solve, arbitrary algebraic design-spec block, or sparse process Jacobian.

Every stream property is derived in binary64 JavaScript Number arithmetic. Geometry uses float32 GPU buffers. GPU rendering precision is never used for material or energy balances. Root solves are bracketed, and PH states are residual-checked. Summations use compensated accumulation for improved cancellation behavior. Numerical output includes component, mass, energy, recycle, and global balance diagnostics.

## Worker protocol and cancellation

The UI sends `{id, action, project, spec}`. Actions are `simulate` and `sensitivity`. The Worker replies with progress messages, a complete result, or a structured error. Run identifiers and physical model revisions gate acceptance. Cancellation terminates the Worker; it does not leave a partially evaluated graph in the active result store. New jobs receive fresh Worker state.

The multi-file application starts a native module Worker. The standalone packager emits an isolated-scope classic Worker bundle and a classic main bundle. Each source module executes in its own lexical closure, preventing cross-module local-name collisions. Only the static named-import and exported declaration syntax used by this project is supported; unsupported syntax fails packaging explicitly. This is not a general-purpose JavaScript bundler.

No application network service is needed. Browser-local persistence is attempted with localStorage and caught when unavailable. JSON download/import is the portable persistence path. Opening a project always clears prior results and solver history.

## WebGPU renderer

`renderer.js` owns two canvases: GPU geometry beneath a crisp 2D label/interaction overlay. It directly requests a WebGPU adapter/device and compiles WGSL, without Three.js, Babylon.js, a canvas framework, or a WebGL shim.

The renderer uses two pipelines: a procedural dotted background and a packed triangle-list scene. Equipment outlines, icons, connection polylines, arrows, selection frames, and visible ports become triangles with interleaved float32 position/color attributes. The whole model scene shares a vertex buffer and a camera bind group. Geometry is uploaded after scene changes; pan/zoom updates a 32-byte camera uniform rather than rebuilding the vertex data. Demand-driven requestAnimationFrame scheduling avoids an idle animation loop. The device pixel ratio is capped at two to bound backing-store cost.

Rounded shapes are tessellated on the CPU. Current picking is CPU-side, using fixed-size spatial bins for operation candidates and cached orthogonal segments for stream distance tests. Text is a Canvas 2D overlay, not a GPU glyph atlas. Geometry edits currently rebuild the scene batch; there is no per-object incremental GPU patching, full viewport culling, instance-buffer renderer, or demonstrated million-object scalability. Orthogonal routes are deterministic but are not obstacle-avoiding Manhattan pathfinding. The “fast” design choices are inspectable; no frame-rate guarantee is claimed.

Shader compilation failures, missing adapters, initialization errors, and device loss choose the functional Canvas 2D backend. A canvas that has been configured for WebGPU is replaced before acquiring a 2D context. Both backends consume the same generated geometry. The actual backend is visible in the status bar.

WebGPU is specified for secure contexts; use localhost or HTTPS and a browser with a working adapter. The delivery's executed browser checks used Canvas 2D. Runtime-check the GPU path and device-loss recovery on deployment hardware. W3C references: https://www.w3.org/TR/webgpu/ and https://www.w3.org/TR/WGSL/.

## Extending without corrupting the physics

A new operation needs a semantic descriptor in `TYPES`, a numerical branch in `unitOperation`, a specification form, a vector symbol, and independent analytical/conservation tests. Do not implement a new visual block that bypasses component or energy residual recording. A genuinely different thermodynamic method belongs behind the same state/flash API, with a consistent enthalpy reference across every participating species and phase.

For a cubic EOS or activity-coefficient method, implement fugacity coefficients, phase stability, appropriate phase/root selection, temperature-dependent parameters, departure enthalpy, and validated interaction data. Reusing the current Raoult calorics under an EOS method name would be misleading. For enthalpy-based studies, test multiple roots and near-degenerate phase states, not only normal operating points.

A larger next-generation flowsheet solver would add scaled residual/Jacobian interfaces, sparse simultaneous solution, explicit design specifications, robust initialization/continuation, and independent property-package verification. Those interfaces are not falsely represented as present in this release.

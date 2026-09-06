# GitHub Pages deployment

Repository: https://github.com/wieslawsoltes/VaporaProcessStudio

Application URL: https://wieslawsoltes.github.io/VaporaProcessStudio/

## Source and publication branches

`main` contains the editable application source, numerical engine, tests, example projects, documentation, and standalone packager. `gh-pages` contains the version selected for publication. GitHub Pages serves the root of `gh-pages`; `.nojekyll` disables Jekyll processing.

The application requires no build step to run on Pages. `index.html` loads `styles.css` and `src/main.js`. All module imports are relative, and the solver Worker is resolved relative to its importing module, so the repository subpath is preserved. The standalone HTML is an optional generated build, not the Pages entry point.

## Publish a tested update

From a local clone with committed changes on `main`:

```sh
git switch main
git pull --ff-only origin main
npm test
npm run validate
npm run build

# Review and commit any intended source or generated-report changes first.
git push origin main
git push origin main:gh-pages
```

The second push updates the publishing branch. A push to `main` alone does not advance `gh-pages`. There is no custom auto-sync workflow in this repository. Use ordinary fast-forward pushes; do not force-push over independent edits on either branch.

GitHub's built-in Pages deployment can be inspected in the repository's Actions and Pages settings. A successful source push is not by itself proof that the published site has finished deploying.

## Reconfigure Pages when needed

In repository **Settings → Pages**, select **Deploy from a branch**, then **gh-pages** and **/ (root)**. Save the source selection and check the deployment result before treating the site as published.

## Verification boundary

The source was checked against the tested delivery using Git blob hashes. Local validation passed 54 engine/model tests, 11 generated analytical/conservation checks, and 22 browser integration checks. Browser integration used the Canvas 2D fallback and a real solver Worker; it did not validate a hardware WebGPU adapter.

A local or Pages deployment should show the actual renderer in the status bar. WebGPU failure falls back to Canvas 2D without substituting mock simulation results. Numerical calculations run as binary64 JavaScript in the Worker, independently of the graphics backend.

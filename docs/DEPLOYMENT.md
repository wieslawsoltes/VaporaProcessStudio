# GitHub Pages deployment

Repository: https://github.com/wieslawsoltes/VaporaProcessStudio

Application URL: https://wieslawsoltes.github.io/VaporaProcessStudio/

Standalone build: https://wieslawsoltes.github.io/VaporaProcessStudio/Vapora-Process-Studio.html

## Automatic publication from main

The workflow `.github/workflows/pages.yml` runs on pushes to `main` and supports manual dispatch. It runs all engine/model tests, regenerates the numerical validation reports, builds the standalone HTML, assembles a static-site artifact, and deploys through the `github-pages` environment. A post-deployment check requests the published entry point, main module, solver Worker, stylesheet, and standalone HTML and verifies expected content.

The `gh-pages` branch is retained as an initial source snapshot. It is not the trigger for this workflow; no branch synchronization is required for future deployments. The workflow uses the `main` ref and retains the repository's existing environment protection rules rather than modifying them.

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
```

Inspect the **Test and deploy GitHub Pages** workflow in the repository's Actions tab. A successful source push is not proof of deployment: confirm that both the build and deploy jobs, including the published-asset check, succeed.

## Static-site layout

The native-module entry point is `index.html`, which loads `styles.css` and `src/main.js`. Module imports are relative, and the solver Worker resolves relative to its importing module, preserving the repository subpath. The deployment also includes the portable `Vapora-Process-Studio.html`. No CDN, backend, package installation, or runtime service is required.

The artifact contains only the application assets and `.nojekyll`. Tests, example project files, and engineering documentation remain available in the source repository rather than being exposed as runtime dependencies.

## Pages configuration

When configuring a new copy of this repository, choose **Settings → Pages → Source: GitHub Actions**. The `github-pages` environment must permit deployment from `main`. Do not weaken existing protection rules or force-push history to resolve a deployment failure; inspect the failing job and use the intended source branch.

## Verification boundary

The source was checked against the tested delivery using Git blob hashes. Local validation passed 54 engine/model tests, 11 generated analytical/conservation checks, and 22 browser integration checks. Browser integration used the Canvas 2D fallback and a real solver Worker; it did not validate a hardware WebGPU adapter.

The workflow's final check establishes that the expected files are served from the published URLs; it does not execute a remote browser or validate the WebGPU backend. The actual renderer is displayed in the app's status bar. Numerical calculations use binary64 JavaScript in the Worker independently of the graphics backend.

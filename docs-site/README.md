# docs-site — Aether docusaurus site

This directory holds the docusaurus 3 site that publishes to
`https://aether.github.io/aether/`.

## Layout

- `docusaurus.config.js` — site config (title, navbar, footer, prism theme)
- `sidebars.js` — sidebar structure. **Auto-generates the ADR list**
  by reading `docs/adr/README.md` at build time, so adding a new ADR
  to `docs/adr/` automatically shows up in the sidebar.
- `docs/intro.md` — the landing page (`/`)
- `docs/quickstart.md` — the 5-line quickstart
- `docs/architecture/intro.md` + `memory.md` + `adr/` (symlinks to
  the root `docs/adr/` directory) — the architecture section
- `docs/modules/{gateway,sandbox,skill-loader,ebpf}.md` — per-module
  reference
- `docs/reference/{cli,llm,compliance,security}.md` — reference
- `docs/community/{contributing,code-of-conduct,security,changelog}.md`
  — community section
- `docs/roadmap.md` — the project roadmap
- `src/css/custom.css` — small CSS overrides (badge prefix on ADR
  links, blue color scheme)

## Render locally

```bash
cd docs-site
npm install
npm run start
# Open http://localhost:3000/aether/
```

## Build for production

```bash
cd docs-site
npm run build
# Output: docs-site/build/
```

## Deploy to GitHub Pages

The repo's `.github/workflows/docs.yml` runs on push to main and
uses `actions/deploy-pages` + `actions/upload-pages-artifact`.
Required: repo Settings → Pages → Source = "GitHub Actions".

## Content strategy

The canonical content lives in the repo root (`README.md`,
`requirements/`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`CHANGELOG.md`, `docs/adr/`). The docs-site **mirrors** that content
in docusaurus-friendly form — not vice versa. Adding a new ADR to
`docs/adr/` is the single source-of-truth change; the docusaurus
site picks it up automatically via the `sidebars.js` auto-generator.

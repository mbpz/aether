// @ts-check
// `@type` JSDoc annotations let editors provide autocompletion and type checking.
// (When running `docusaurus build` Docusaurus loads this file as ES module.)

import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Aether',
  tagline: 'Privacy-first AI agent runtime. Zero-trust sandbox, three-tier skill disclosure, SOC2-compliant audit log.',
  favicon: 'img/favicon.ico',

  // Set the production url of your site here
  url: 'https://aether-demo.example.com',
  // Set the /base/ path of your site to the repo's name on GitHub Pages.
  // The user-org subdomain is replaced; the rest must match.
  baseUrl: '/aether/',

  // GitHub pages deployment config.
  organizationName: 'aether',
  projectName: 'aether',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: 'docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          // Pull ADRs, requirements, and CONTRIBUTING/SECURITY/CoC
          // from the repo root (they live outside this docs-site).
          // Symlink vs include; we use include here to keep docs-site
          // self-contained (no symlinks in GH Pages artifacts).
          //
          // Note: for simplicity each doc page is duplicated under
          // docs-site/docs/ via the build step. We use the ADRs from
          // the root via a relative import — see src/pages/adr.md.
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/social-card.png',
      navbar: {
        title: 'Aether',
        items: [
          { type: 'doc', docId: 'intro', position: 'left', label: 'Docs' },
          { type: 'doc', docId: 'quickstart', position: 'left', label: 'Quickstart' },
          { type: 'doc', docId: 'architecture/intro', position: 'left', label: 'Architecture' },
          { type: 'doc', docId: 'reference/llm', position: 'left', label: 'Reference' },
          { type: 'doc', docId: 'community/contributing', position: 'right', label: 'Contribute' },
          {
            href: 'https://github.com/aether/aether',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Quickstart', to: '/quickstart' },
              { label: 'Architecture', to: '/architecture/intro' },
              { label: 'API reference', to: '/reference/llm' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'Contributing', to: '/community/contributing' },
              { label: 'Code of Conduct', to: '/community/code-of-conduct' },
              { label: 'Security', to: '/community/security' },
            ],
          },
          {
            title: 'Project',
            items: [
              { label: 'Roadmap', to: '/roadmap' },
              { label: 'GitHub', href: 'https://github.com/aether/aether' },
              { label: 'Changelog', to: '/community/changelog' },
            ],
          },
        ],
        copyright: `Copyright © 2026 The Aether Authors. Licensed under Apache-2.0.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'typescript', 'json', 'yaml'],
      },
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
    }),
};

export default config;

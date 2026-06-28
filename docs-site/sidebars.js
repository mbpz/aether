// @ts-check
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Sidebar generator. The structure is:
 *  - Getting Started (intro + quickstart)
 *  - Architecture (ADRs + system overview)
 *  - Modules (gateway, sandbox, skill-loader, eBPF)
 *  - Reference (LLM providers, compliance)
 *  - Community (CONTRIBUTING, SECURITY, CoC, CHANGELOG)
 *
 * We generate the ADRs list from the filesystem at build time so
 * new ADRs added in `docs/adr/` automatically show up without
 * editing this file.
 */
function listAdrFiles() {
  const adrDir = join(__dirname, '..', 'docs', 'adr');
  try {
    const files = readFileSync(join(adrDir, 'README.md'), 'utf-8');
    return files
      .split('\n')
      .filter((l) => /^\| \[(\d+)\]/.test(l))
      .map((l) => {
        const m = l.match(/^\| \[(\d+)\]\(([^)]+)\)\s*\|\s*([^|]+)\|/);
        if (!m) return null;
        return { id: Number(m[1]), path: m[2], title: m[3].trim() };
      })
      .filter(Boolean)
      .sort((a, b) => a.id - b.id);
  } catch (err) {
    return [];
  }
}

const adrItems = listAdrFiles().map((a) => ({
  type: 'doc',
  id: `architecture/adr/${String(a.id).padStart(3, '0')}-${a.path.split('/').pop().replace(/\.md$/, '')}`,
  label: `${String(a.id).padStart(3, '0')}: ${a.title}`,
}));

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'getting-started',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['intro', 'quickstart'],
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'architecture/intro',
        'architecture/memory',
        {
          type: 'category',
          label: 'Architecture Decision Records',
          collapsed: true,
          items: adrItems,
        },
      ],
    },
    {
      type: 'category',
      label: 'Modules',
      collapsed: true,
      items: [
        'modules/gateway',
        'modules/sandbox',
        'modules/skill-loader',
        'modules/ebpf',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: true,
      items: [
        'reference/cli',
        'reference/llm',
        'reference/compliance',
        'reference/security',
      ],
    },
    {
      type: 'category',
      label: 'Community',
      collapsed: true,
      items: [
        'community/contributing',
        'community/code-of-conduct',
        'community/security',
        'community/changelog',
      ],
    },
  ],
};

export default sidebars;

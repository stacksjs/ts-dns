import type { BunpressConfig } from 'bunpress'

const config: BunpressConfig = {
  name: 'dnsx',
  description: 'A command-line & library DNS client. Like dig & dog, but for TypeScript.',
  theme: '@bunpress/theme-docs',
  srcDir: './docs',
  outDir: './dist/docs',
  sidebar: [
    {
      text: 'Getting Started',
      items: [
        { text: 'Introduction', link: '/intro' },
        { text: 'Installation', link: '/install' },
        { text: 'Usage', link: '/usage' },
        { text: 'Configuration', link: '/config' },
      ],
    },
    {
      text: 'Features',
      items: [
        { text: 'DNS Queries', link: '/features/dns-queries' },
        { text: 'Record Types', link: '/features/record-types' },
        { text: 'Multiple Resolvers', link: '/features/multiple-resolvers' },
        { text: 'JSON Output', link: '/features/json-output' },
      ],
    },
    {
      text: 'Advanced',
      items: [
        { text: 'Configuration', link: '/advanced/configuration' },
        { text: 'Custom Resolvers', link: '/advanced/custom-resolvers' },
        { text: 'Performance', link: '/advanced/performance' },
        { text: 'CI/CD Integration', link: '/advanced/ci-cd-integration' },
      ],
    },
  ],
}

export default config

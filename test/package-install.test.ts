import { expect, test } from 'bun:test'
import manifest from '../package.json'

test('consumer lifecycle scripts leave hook installation to contributors', () => {
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare']
  const hookScripts = Object.entries(manifest.scripts).filter(([phase, command]) =>
    lifecycle.includes(phase) && /\b(?:bun-)?git-hooks\b/.test(command),
  )
  expect(hookScripts).toEqual([])
})

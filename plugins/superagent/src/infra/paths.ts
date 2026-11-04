/** Resolves packaged asset paths from either the source tree or the compiled lib/ output. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package names this fork is installed under: the scoped npm name, and the upstream name of the vendored prototype. */
const PACKAGE_NAMES = new Set(['@sredevopsorg/dsh-superagent', 'dsh-superagent'])
let cached: string | undefined
export function packageRoot(): string {
  if (cached) return cached
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth++) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try {
        // The fork's scoped name, and the upstream package name so a source checkout of the prototype still resolves.
        if (PACKAGE_NAMES.has((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ?? '')) return cached = directory
      }
      catch { /* A foreign package.json on the way up is not this package. */ }
    }
    directory = dirname(directory)
  }
  throw new Error('dsh-superagent package root not found')
}
export const packagePath = (...parts: string[]): string => join(packageRoot(), ...parts)

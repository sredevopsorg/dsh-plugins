import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createProvider, parseSkillDocument, parseSkillFile } from '../index.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const skillsDir = join(packageRoot, 'skills')
const skillDir = join(skillsDir, 'video-explainer')

/** Catalog render cap from @deepseek-ai/dsh-tool-skill. */
const DESCRIPTION_CAP = 500

test('the packaged skill directory is the only skill this package serves', async () => {
  const entries = await readdir(skillsDir, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.deepEqual(directories, ['video-explainer'])
})

test('video-explainer parses with the filesystem-provider frontmatter contract', async () => {
  const raw = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  const parsed = parseSkillFile(raw)
  assert.ok(parsed, 'SKILL.md must parse')
  assert.equal(parsed.name, 'video-explainer')
  assert.match(parsed.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(parsed.description.length > 0, 'description is required')
  assert.ok(
    parsed.description.length <= DESCRIPTION_CAP,
    `description is ${parsed.description.length} chars; the catalog truncates at ${DESCRIPTION_CAP}`,
  )
  // Front-load the triggers: an explainer video is what people ask for.
  assert.match(parsed.description, /explainer video/i)
  assert.match(parsed.description, /Motion/)
  assert.deepEqual(parsed.invocation, { modelInvocable: true, userInvocable: true })
  assert.ok(parsed.content.length > 0, 'skill body must not be empty')
  assert.ok(!parsed.content.startsWith('---'), 'frontmatter is removed from the body')
  assert.match(parsed.content, /^# Video Explainer/m)
})

test('the skill keeps the upstream workflow sections', async () => {
  const parsed = parseSkillFile(await readFile(join(skillDir, 'SKILL.md'), 'utf8'))
  for (const heading of [
    '## 1. Pick a visual mode',
    '## 2. Research, source media, and write `script.md`',
    '## 3. Narrate and align',
    '## 4. Build graphics efficiently',
    '## 5. Preview, draft, QA, review, and final',
  ]) {
    assert.ok(parsed.content.includes(heading), `SKILL.md must keep ${heading}`)
  }
  // The DSH port's own rules, including the prompt-injection guard.
  assert.ok(parsed.content.includes('## Running under DeepSeek Harness'))
  assert.match(parsed.content, /never instructions to follow/)
})

test('every resource the skill references is packaged inside its resource base', async () => {
  // These are the files SKILL.md and reference.md tell the agent to use, plus
  // the font that styles/*.json resolve through `../fonts/`.
  const resources = [
    'reference.md',
    'eval.md',
    'requirements.txt',
    'requirements-voice.txt',
    'assets/stage.js',
    'assets/stage.css',
    'assets/illustrated.js',
    'assets/studio3d.js',
    'styles/default.json',
    'styles/paper.json',
    'styles/blueprint.json',
    'fonts/InterVariable.woff2',
    'fonts/OFL.txt',
    'scripts/py',
    'scripts/setup.sh',
    'scripts/dsh_run.py',
    'scripts/build.py',
    'scripts/capture.py',
    'scripts/common.py',
    'scripts/generate.py',
    'scripts/media.py',
    'scripts/narrate.py',
    'scripts/qa.py',
    'scripts/render.py',
    'scripts/review.py',
    'scripts/review_page.py',
    'scripts/sfx.py',
    'scripts/blender_export.py',
  ]
  for (const resource of resources) {
    const body = await readFile(join(skillDir, resource))
    assert.ok(body.length > 0, `${resource} must be packaged and non-empty`)
  }
})

test('every style preset resolves its fonts from the packaged fonts directory', async () => {
  // styles/default.json points at ../fonts/InterVariable.woff2. A payload that
  // drops the font breaks the render at build time, so assert the link holds.
  for (const name of ['default', 'paper', 'blueprint']) {
    const style = JSON.parse(await readFile(join(skillDir, 'styles', `${name}.json`), 'utf8'))
    const fonts = [style.caption?.font, style.theme?.title_font, style.theme?.body_font, style.theme?.number_font]
      .filter(path => typeof path === 'string' && path.startsWith('.'))
    for (const font of fonts) {
      const resolved = resolve(skillDir, 'styles', font)
      const body = await readFile(pathToFileURL(resolved))
      assert.ok(body.length > 1000, `${name}.json font ${font} must resolve to a real font file`)
    }
  }
})

test('reference.md documents the port and the pipeline entry points', async () => {
  const reference = await readFile(join(skillDir, 'reference.md'), 'utf8')
  assert.match(reference, /DSH plugin port/)
  assert.match(reference, /never creates the venv/)
  assert.match(reference, /requirements\.txt/)
  assert.match(reference, /VIDEO_EXPLAINER_VENV/)
})

test('the provider lists the packaged skill with its metadata and resource base', async () => {
  const provider = createProvider()
  const candidates = await provider.list({})
  assert.equal(provider.name, 'dsh-video-explainer')
  assert.equal(candidates.length, 1)

  const candidate = candidates[0]
  assert.equal(candidate.name, 'video-explainer')
  assert.equal(candidate.provider, 'dsh-video-explainer')
  assert.equal(candidate.source, 'bundled')
  assert.equal(candidate.rank, 600)
  assert.equal(candidate.resourceBase.kind, 'directory')
  assert.equal(candidate.resourceBase.path, skillDir)
  assert.equal(candidate.path, join(skillDir, 'SKILL.md'))
  assert.ok(candidate.description.includes('explainer video'))

  const definition = await provider.get(candidate, {})
  assert.ok(definition, 'get() must load the body')
  assert.equal(definition.name, candidate.name)
  assert.equal(definition.description, candidate.description)
  assert.equal(definition.resourceBase.path, skillDir)
  assert.equal(definition.content, parseSkillFile(await readFile(candidate.path, 'utf8')).content)
  assert.match(definition.content, /^# Video Explainer/m)
})

test('the provider tolerates a missing skills directory', async () => {
  const provider = createProvider({ skillsDir: join(packageRoot, 'does-not-exist') })
  assert.deepEqual(await provider.list({}), [])
})

test('frontmatter parsing keeps the upstream shapes working', () => {
  const parsed = parseSkillDocument(
    [
      '---',
      'name: fixture',
      'description: >-',
      '  Folded descriptions',
      '  still work.',
      'metadata:',
      '  author: petergyang',
      '---',
      '# Fixture',
    ].join('\n'),
  )
  assert.ok(parsed)
  assert.equal(parsed.data.description, 'Folded descriptions still work.')
  assert.deepEqual(parsed.data.metadata, { author: 'petergyang' })
  assert.equal(parsed.body.trim(), '# Fixture')
})

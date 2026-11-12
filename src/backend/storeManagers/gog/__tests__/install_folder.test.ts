import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { looksLikeGogInstall, resolveGogInstallFolder } from '../install_folder'

describe('resolveGogInstallFolder', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'heroic-gog-install-folder-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('uses folder_name when that directory exists', () => {
    const named = join(root, 'Game Name')
    mkdirSync(named)
    expect(resolveGogInstallFolder(root, 'Game Name', '1')).toBe(named)
  })

  test('finds a sibling folder when folder_name is missing', () => {
    const found = join(root, 'Actual')
    mkdirSync(found)
    writeFileSync(join(found, 'goggame-1.info'), '{}')
    expect(resolveGogInstallFolder(root, undefined, '1')).toBe(found)
  })

  test('uses the base path when the game was written there', () => {
    writeFileSync(join(root, 'goggame-1.info'), '{}')
    expect(resolveGogInstallFolder(root, undefined, '1')).toBe(root)
  })

  test('finds a Linux native layout', () => {
    const game = join(root, 'LinuxGame')
    mkdirSync(join(game, 'game'), { recursive: true })
    writeFileSync(join(game, 'gameinfo'), 'Name\n1.0\n\nen-US\n1\n')
    expect(looksLikeGogInstall(game, '1')).toBe(true)
    expect(resolveGogInstallFolder(root, undefined, '1')).toBe(game)
  })

  test('returns undefined when nothing looks like a GOG install', () => {
    mkdirSync(join(root, 'empty'))
    expect(resolveGogInstallFolder(root, 'Missing', '1')).toBeUndefined()
  })
})

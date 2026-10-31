import {
  getDefaultWine,
  getWineExecs,
  getWineLibs,
  isUnchosenWineDefault,
  preferredProton
} from '../compatibility_layers'
import type { WineInstallation } from 'common/types'
import { mkdirSync } from 'graceful-fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import child_process from 'child_process'

jest.mock('../../logger')

describe('getDefaultWine', () => {
  test('return wine not found', () => {
    const expected = {
      bin: '',
      name: 'Default Wine - Not Found',
      type: 'wine'
    }
    jest.spyOn(child_process, 'execSync').mockImplementation(() => {
      throw new Error()
    })
    const result = getDefaultWine()
    expect(result).toEqual(expected)
  })

  test('return list with one default wine', () => {
    // spy on the execSync calling which wine and returning /usr/bin/wine
    jest.spyOn(child_process, 'execSync').mockImplementation((command) => {
      if (command === 'which wine') {
        return '/usr/bin/wine\n'
      } else if (command === 'wine --version') {
        return 'wine-6.0 (Staging)\n'
      }
      throw new Error('Unexpected command')
    })

    const result = getDefaultWine()
    expect(result.bin).toBe('/usr/bin/wine')
    expect(result.name).toBe('wine-6.0 (Staging)')
    expect(result.type).toBe('wine')
  })
})

const proton = (name: string): WineInstallation => ({
  bin: `/proton/${name}/proton`,
  name,
  type: 'proton'
})

describe('preferredProton', () => {
  test('prefers Proton-CachyOS, then Proton-GE, over other Proton builds', () => {
    const chosen = preferredProton([
      proton('Proton 9.0'),
      proton('GE-Proton9-27'),
      proton('proton-cachyos-9.0-20250101'),
      proton('GE-Proton10-15')
    ])
    expect(chosen?.name).toBe('proton-cachyos-9.0-20250101')
  })

  test('uses the newest GE-Proton when CachyOS is not installed', () => {
    const chosen = preferredProton([
      proton('GE-Proton9-27'),
      proton('GE-Proton-latest'),
      proton('GE-Proton10-15'),
      proton('proton-ge-8-25')
    ])
    expect(chosen?.name).toBe('GE-Proton10-15')
  })

  test('uses any other Proton when GE and CachyOS are absent', () => {
    expect(preferredProton([proton('Proton 9.0')])?.name).toBe('Proton 9.0')
  })

  test('ignores Wine installs', () => {
    expect(
      preferredProton([
        { bin: '/usr/bin/wine', name: 'wine-9.0', type: 'wine' }
      ])
    ).toBeUndefined()
  })
})

describe('isUnchosenWineDefault', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('treats a missing or system Wine as the automatic default', () => {
    jest.spyOn(child_process, 'execSync').mockImplementation((command) => {
      if (command === 'which wine') return '/usr/bin/wine\n'
      if (command === 'wine --version') return 'wine-9.0\n'
      throw new Error('Unexpected command')
    })

    expect(isUnchosenWineDefault(undefined)).toBe(false)
    expect(
      isUnchosenWineDefault({
        bin: '/usr/bin/wine',
        name: 'wine-9.0',
        type: 'wine'
      })
    ).toBe(true)
    expect(
      isUnchosenWineDefault({
        bin: '',
        name: 'Default Wine - Not Found',
        type: 'wine'
      })
    ).toBe(true)
    expect(
      isUnchosenWineDefault({
        bin: '/usr/bin/wine',
        name: 'Wine Default',
        type: 'wine'
      })
    ).toBe(true)
  })

  test('leaves a chosen Wine or Proton alone', () => {
    jest.spyOn(child_process, 'execSync').mockImplementation((command) => {
      if (command === 'which wine') return '/usr/bin/wine\n'
      if (command === 'wine --version') return 'wine-9.0\n'
      throw new Error('Unexpected command')
    })

    expect(
      isUnchosenWineDefault({
        bin: '/home/user/.config/heroic/tools/wine/Wine-GE/bin/wine',
        name: 'Wine-GE',
        type: 'wine'
      })
    ).toBe(false)
    expect(isUnchosenWineDefault(proton('GE-Proton10-15'))).toBe(false)
  })
})

describe('getWineLibs', () => {
  it('should return empty strings if lib and lib32 do not exist', () => {
    const wineBin = '/path/to/wine'
    const { lib, lib32 } = getWineLibs(wineBin)
    expect(lib).toBe('')
    expect(lib32).toBe('')
  })

  it('should return the path to lib32 if it exists', () => {
    const wineBin = join(tmpdir(), 'wine_test')
    const wineDir = join(wineBin, '..')
    const lib32Path = join(wineDir, '../lib')
    mkdirSync(lib32Path, { recursive: true })
    const { lib32 } = getWineLibs(wineBin)
    expect(lib32).toBe(lib32Path)
  })

  it('should return the path to lib if it exists', () => {
    const wineBin = join(tmpdir(), 'wine_test')
    const wineDir = join(wineBin, '..')
    const libPath = join(wineDir, '../lib64')
    mkdirSync(libPath, { recursive: true })
    const { lib } = getWineLibs(wineBin)
    expect(lib).toBe(libPath)
  })

  it('should return the paths to lib and lib32 if they both exist', () => {
    const wineBin = join(tmpdir(), 'wine_test')
    const wineDir = join(wineBin, '..')
    const libPath = join(wineDir, '../lib64')
    const lib32Path = join(wineDir, '../lib')
    mkdirSync(libPath, { recursive: true })
    mkdirSync(lib32Path, { recursive: true })
    const { lib, lib32 } = getWineLibs(wineBin)
    expect(lib).toBe(libPath)
    expect(lib32).toBe(lib32Path)
  })
})

describe('getWineExes', () => {
  describe('getWineExecs', () => {
    it('should return the path to wineserver if it exists', () => {
      const wineBin = join(tmpdir(), 'wine_test')
      const wineDir = dirname(wineBin)
      const wineServerPath = join(wineDir, 'wineserver')
      mkdirSync(wineServerPath, { recursive: true })
      const execs = getWineExecs(wineBin)
      expect(execs.wineserver).toBe(wineServerPath)
    })

    it('should return an empty string if wineserver does not exist', () => {
      const wineBin = '/path/to/wine'
      const execs = getWineExecs(wineBin)
      expect(execs.wineserver).toBe('')
    })
  })
})

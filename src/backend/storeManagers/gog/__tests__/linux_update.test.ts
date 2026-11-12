import { linuxGameinfoVersion, linuxInstallerIsCurrent } from '../linux_update'

describe('linuxInstallerIsCurrent', () => {
  test('API miss or empty installer list is not an update', () => {
    expect(linuxInstallerIsCurrent(undefined, '1.0')).toBe(true)
    expect(linuxInstallerIsCurrent([], '1.0')).toBe(true)
  })

  test('no linux installer in the list is not an update', () => {
    expect(
      linuxInstallerIsCurrent([{ os: 'windows', version: '2.0' }], '1.0')
    ).toBe(true)
  })

  test('matching linux installer version is current', () => {
    expect(
      linuxInstallerIsCurrent(
        [
          { os: 'windows', version: '9' },
          { os: 'linux', version: '1.2.3' }
        ],
        '1.2.3'
      )
    ).toBe(true)
  })

  test('different linux installer version is an update', () => {
    expect(
      linuxInstallerIsCurrent([{ os: 'linux', version: '1.2.4' }], '1.2.3')
    ).toBe(false)
  })
})

describe('linuxGameinfoVersion', () => {
  test('reads the version line from a GOG gameinfo file', () => {
    expect(linuxGameinfoVersion('Game 4\n1.0\n\nen-US\n4\n')).toBe('1.0')
  })

  test('ignores an empty version line', () => {
    expect(linuxGameinfoVersion('Game 4\n\n\nen-US\n4\n')).toBeUndefined()
  })
})

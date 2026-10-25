import {
  assessRedistManifest,
  type RedistManifestSnapshot
} from '../redist_decision'

const manifest: RedistManifestSnapshot = {
  build_id: '100',
  depots: [
    {
      dependencyId: 'ISI',
      executable: { path: '__redist/ISI/scriptinterpreter.exe' }
    },
    {
      dependencyId: 'VC_2019',
      executable: { path: '__redist/VC_2019/vc_redist.x64.exe' }
    },
    {
      dependencyId: 'PHYSXLEGACY',
      executable: { path: 'ISI/physx.exe' }
    }
  ]
}

describe('assessRedistManifest', () => {
  test('downloads redistributables when they have never been stored', () => {
    expect(assessRedistManifest(undefined, ['ISI'], '100')).toEqual({
      update: true,
      installed: []
    })
  })

  test('does not download again when the manifest already lists them', () => {
    expect(
      assessRedistManifest(manifest, ['ISI', 'VC_2019', 'PHYSXLEGACY'], '100')
    ).toEqual({
      update: false,
      installed: ['ISI', 'VC_2019']
    })
  })

  test('downloads when GOG publishes a new redistributable repository', () => {
    expect(
      assessRedistManifest(
        { ...manifest, HGLInstalled: ['ISI', 'VC_2019'] },
        ['ISI', 'VC_2019'],
        '101'
      ).update
    ).toBe(true)
  })

  test('downloads when a newly required shared redistributable is not recorded', () => {
    expect(
      assessRedistManifest(
        { ...manifest, HGLInstalled: ['ISI'] },
        ['ISI', 'VC_2019'],
        '100'
      ).update
    ).toBe(true)
  })

  test('leaves an already recorded set alone', () => {
    expect(
      assessRedistManifest(
        { ...manifest, HGLInstalled: ['VC_2019', 'ISI'] },
        ['ISI', 'VC_2019', 'PHYSXLEGACY'],
        '100'
      ).update
    ).toBe(false)
  })
})

import { gogdlProcessPattern } from '../gogdl_kill'

describe('gogdlProcessPattern', () => {
  test('requires the gogdl binary name so a numeric id is not a match by itself', () => {
    expect(gogdlProcessPattern('1207660573')).toBe('gogdl.*1207660573')
  })

  test('does not match a command line that only contains the product id', () => {
    const pattern = new RegExp(gogdlProcessPattern('1207660573'))
    expect(pattern.test('/usr/bin/unrelated --pid 1207660573')).toBe(false)
    expect(
      pattern.test('/opt/Heroic/gogdl download 1207660573 --platform linux')
    ).toBe(true)
  })
})

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

jest.mock('backend/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  LogPrefix: { Gog: 'GOG' }
}))

import {
  GOGDL_RESUME_FILE,
  GOG_INCOMPLETE_FILE,
  clearGogdlResume,
  clearGogInstallIncomplete,
  gogInstallLooksIncomplete,
  markGogInstallIncomplete,
  recordGogWriteStall
} from '../gog_install_state'

describe('gog install stall leftovers', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'heroic-gog-stall-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('recordGogWriteStall drops the resume file and marks Play unsafe', () => {
    writeFileSync(join(root, GOGDL_RESUME_FILE), 'resume')
    recordGogWriteStall(root)

    expect(gogInstallLooksIncomplete(root)).toBe(true)
    expect(() => readFileSync(join(root, GOGDL_RESUME_FILE))).toThrow()
    expect(readFileSync(join(root, GOG_INCOMPLETE_FILE), 'utf8')).toContain(
      'stalled'
    )
  })

  test('clearGogInstallIncomplete allows Play again', () => {
    mkdirSync(root, { recursive: true })
    markGogInstallIncomplete(root)
    expect(gogInstallLooksIncomplete(root)).toBe(true)
    clearGogInstallIncomplete(root)
    expect(gogInstallLooksIncomplete(root)).toBe(false)
  })

  test('a leftover resume file alone is incomplete', () => {
    writeFileSync(join(root, GOGDL_RESUME_FILE), 'resume')
    expect(gogInstallLooksIncomplete(root)).toBe(true)
    clearGogdlResume(root)
    expect(gogInstallLooksIncomplete(root)).toBe(false)
  })

  test('missing folder is a no-op', () => {
    expect(recordGogWriteStall(join(root, 'missing'))).toBeUndefined()
    expect(gogInstallLooksIncomplete(undefined)).toBe(false)
  })
})

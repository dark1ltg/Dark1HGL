import { GogWriteProgress } from '../write_progress'

const MiB = 1024 * 1024

function harness(writes: Map<number, number>) {
  let now = 0
  let pids = [10]
  const progress = new GogWriteProgress({
    now: () => now,
    pids: () => pids,
    writeBytes: (pid) => writes.get(pid)
  })
  progress.setPid(10)
  return {
    progress,
    at(time: number) {
      now = time
    },
    setPids(next: number[]) {
      pids = next
    }
  }
}

describe('GogWriteProgress', () => {
  test('uses bytes written over bytes downloaded', () => {
    const { progress } = harness(new Map([[10, 0]]))
    const update = progress.ingest(
      [
        'Progress: 94.31 100000000/200000000, Running for: 00:10:00, ETA: 00:01:54',
        'Downloaded: 190.00 MiB, Written: 95.37 MiB',
        'Download\t- 12.00 MiB/s (raw) / 12.00 MiB/s (decompressed)',
        'Disk\t- 8.00 MiB/s (write) / 1.00 MiB/s (read)'
      ].join('\n')
    )

    expect(update?.writtenBytes).toBe(100000000)
    expect(update?.totalBytes).toBe(200000000)
    expect(update?.percent).toBe(50)
    expect(update?.bytes).toBe('95.4 MB / 190.7 MB')
    expect(update?.eta).toBe('00:01:54')
    expect(update?.diskSpeed).toBe(8)
    expect(update?.downSpeed).toBe(12)
  })

  test('does not republish a progress line that is still on the same file', () => {
    const { progress } = harness(new Map([[10, 0]]))
    progress.ingest(
      'Progress: 50.00 100/200, Running for: 00:00:01, ETA: 00:00:01'
    )
    expect(
      progress.ingest(
        'Progress: 50.00 100/200, Running for: 00:00:02, ETA: 00:00:02'
      )
    ).toBeUndefined()
  })

  test('advances the bar from bytes the writer process has actually written', () => {
    const total = 10 * MiB
    const writes = new Map([[10, 1000]])
    const { progress, at } = harness(writes)
    progress.ingest(
      `Progress: 10.00 ${MiB}/${total}, Running for: 00:00:01, ETA: 00:00:09`
    )

    at(2000)
    writes.set(10, 1000 + 2 * MiB)
    const update = progress.sample()

    expect(update?.writtenBytes).toBe(MiB + 2 * MiB)
    expect(update?.percent).toBe(30)
    expect(update?.diskSpeed).toBeCloseTo(1, 1)
  })

  test('snaps back to gogdl when the next file is reported', () => {
    const total = 20 * MiB
    const writes = new Map([[10, 5000]])
    const { progress, at } = harness(writes)
    progress.ingest(`Progress: 10.00 ${MiB}/${total}, ETA: 00:00:09`)
    at(2000)
    writes.set(10, 5000 + 8 * MiB)
    progress.sample()

    const snapped = progress.ingest(
      `Progress: 40.00 ${8 * MiB}/${total}, ETA: 00:00:04`
    )
    expect(snapped?.writtenBytes).toBe(8 * MiB)

    at(4000)
    writes.set(10, 5000 + 9 * MiB)
    const next = progress.sample()
    expect(next?.writtenBytes).toBe(9 * MiB)
  })

  test('does not count bytes a new writer process had already written', () => {
    const writes = new Map<number, number>([
      [10, 100],
      [11, 50 * MiB]
    ])
    const { progress, at, setPids } = harness(writes)
    progress.ingest('Progress: 10.00 1000/100000000, ETA: 00:10:00')
    setPids([10, 11])
    at(2000)
    expect(progress.sample()).toBeUndefined()

    writes.set(11, 50 * MiB + 4 * MiB)
    at(3000)
    expect(progress.sample()?.writtenBytes).toBe(1000 + 4 * MiB)
  })

  test('stops at the total size', () => {
    const writes = new Map([[10, 0]])
    const { progress, at } = harness(writes)
    progress.ingest('Progress: 90.00 9000/10000, ETA: 00:00:01')
    at(2000)
    writes.set(10, 50 * MiB)
    expect(progress.sample()?.writtenBytes).toBe(10000)
    expect(progress.sample()).toBeUndefined()
  })
})

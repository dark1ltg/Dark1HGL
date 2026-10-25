import { readdirSync, readFileSync } from 'fs'

import type { InstallProgress } from 'common/types'

const MiB = 1024 * 1024

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit <= 1 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

function formatEta(seconds: number): string {
  const capped = Math.max(0, Math.round(seconds))
  const hours = Math.floor(capped / 3600)
  const minutes = Math.floor((capped % 3600) / 60)
  const secs = capped % 60
  return [hours, minutes, secs]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

type ProcessIo = { read: number; write: number }

function readProcessIo(pid: number): ProcessIo | undefined {
  try {
    const text = readFileSync(`/proc/${pid}/io`, 'utf8')
    const read = text.match(/^read_bytes:\s+(\d+)/m)
    const write = text.match(/^write_bytes:\s+(\d+)/m)
    if (!read?.[1] && !write?.[1]) return
    return {
      read: read?.[1] ? Number(read[1]) : 0,
      write: write?.[1] ? Number(write[1]) : 0
    }
  } catch {
    return
  }
}

function listProcessTree(root: number): number[] {
  const parentOf = new Map<number, number>()
  let names: string[] = []
  try {
    names = readdirSync('/proc')
  } catch {
    return [root]
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
      const afterComm = stat.slice(stat.lastIndexOf(')') + 1).trim()
      const ppid = Number(afterComm.split(' ')[1])
      if (Number.isFinite(ppid)) parentOf.set(Number(name), ppid)
    } catch {
      // Process exited while we were reading.
    }
  }

  const children = new Map<number, number[]>()
  for (const [pid, ppid] of parentOf) {
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }

  const ordered: number[] = []
  const seen = new Set<number>()
  const pending = [root]
  while (pending.length) {
    const pid = pending.pop()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    ordered.push(pid)
    for (const child of children.get(pid) ?? []) pending.push(child)
  }
  return ordered
}

type WriteProgressIO = {
  now?: () => number
  pids?: (root: number) => number[]
  bytes?: (pid: number) => ProcessIo | undefined
}

/**
 * GOG's reported percent is bytes written, but a patch only publishes that
 * number when an xdelta window finishes. On an external drive most of that
 * wait is reading the existing game, which keeps the activity light on while
 * the written percent stays still. Read and write bytes from the gogdl
 * process tree keep the UI moving through that gap.
 */
export class GogWriteProgress {
  private readonly now: () => number
  private readonly pids: (root: number) => number[]
  private readonly bytes: (pid: number) => ProcessIo | undefined

  private pid: number | undefined
  private reportedWritten = 0
  private total = 0
  private hasReport = false
  private reportedAt = 0
  private lastEta = ''
  private loggedDiskSpeed = 0
  private loggedDownSpeed = 0
  private lastDisplayed = -1
  private lastSampleAt = 0
  private lastReadExtra = 0
  private lastWriteExtra = 0
  private baseline = new Map<number, ProcessIo>()
  private timer: NodeJS.Timeout | undefined
  private onSample: ((progress: InstallProgress) => void) | undefined

  constructor(io: WriteProgressIO = {}) {
    this.now = io.now ?? (() => Date.now())
    this.pids = io.pids ?? listProcessTree
    this.bytes = io.bytes ?? readProcessIo
  }

  setPid(pid: number | undefined) {
    if (pid && pid !== this.pid) this.pid = pid
  }

  ingest(data: string): InstallProgress | undefined {
    const eta = data.match(/ETA:\s+(\d\d:\d\d:\d\d)/)
    const down = data.match(/Download\s+-\s+(\S+)\s+MiB/)
    const disk = data.match(/Disk\s+-\s+(\S+)\s+MiB/)
    if (eta?.[1]) this.lastEta = eta[1]
    if (down?.[1] && !Number.isNaN(Number(down[1]))) {
      this.loggedDownSpeed = Number(down[1])
    }
    if (disk?.[1] && !Number.isNaN(Number(disk[1]))) {
      this.loggedDiskSpeed = Number(disk[1])
    }

    const progress = data.match(/Progress:\s+(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)/)
    if (!progress?.[2] || !progress[3]) return
    const written = Number(progress[2])
    const total = Number(progress[3])
    if (!Number.isFinite(written) || !Number.isFinite(total) || total <= 0) {
      return
    }

    if (
      this.hasReport &&
      total !== this.total &&
      written < this.reportedWritten
    ) {
      this.hasReport = false
      this.reportedWritten = 0
      this.baseline.clear()
    }
    this.total = total
    const advanced = !this.hasReport || written > this.reportedWritten
    this.hasReport = true
    if (!advanced) return

    this.reportedWritten = written
    this.reportedAt = this.now()
    this.rebase()
    return this.snapshot(written, this.loggedDiskSpeed, this.lastEta, 0)
  }

  sample(): InstallProgress | undefined {
    if (!this.total || !this.pid || !this.hasReport) return
    const now = this.now()
    if (now - this.reportedAt < 1000) return

    const extra = this.extraSinceReport()
    const displayed = Math.min(this.total, this.reportedWritten + extra.write)
    const dt = this.lastSampleAt
      ? (now - this.lastSampleAt) / 1000
      : (now - this.reportedAt) / 1000
    const readDelta = Math.max(0, extra.read - this.lastReadExtra)
    const writeDelta = Math.max(0, extra.write - this.lastWriteExtra)
    this.lastReadExtra = extra.read
    this.lastWriteExtra = extra.write
    this.lastSampleAt = now

    const readSpeed = dt > 0 ? readDelta / dt / MiB : 0
    const writeSpeed = dt > 0 ? writeDelta / dt / MiB : 0
    const moved = displayed !== this.lastDisplayed
    const busy = readDelta > 64 * 1024 || writeDelta > 64 * 1024
    if (!moved && !busy) return

    const remaining = this.total - displayed
    const eta =
      writeSpeed > 0.05
        ? formatEta(remaining / (writeSpeed * MiB))
        : this.lastEta
    return this.snapshot(displayed, writeSpeed, eta, readSpeed)
  }

  watch(onSample: (progress: InstallProgress) => void) {
    if (this.timer || !this.pid || !this.total) return
    this.onSample = onSample
    this.timer = setInterval(() => {
      const progress = this.sample()
      if (progress) this.onSample?.(progress)
    }, 1000)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.onSample = undefined
    this.pid = undefined
    this.reportedWritten = 0
    this.total = 0
    this.hasReport = false
    this.reportedAt = 0
    this.lastEta = ''
    this.loggedDiskSpeed = 0
    this.loggedDownSpeed = 0
    this.lastDisplayed = -1
    this.lastSampleAt = 0
    this.lastReadExtra = 0
    this.lastWriteExtra = 0
    this.baseline.clear()
  }

  private rebase() {
    this.baseline.clear()
    this.lastReadExtra = 0
    this.lastWriteExtra = 0
    this.lastSampleAt = this.now()
    if (!this.pid) return
    for (const pid of this.pids(this.pid)) {
      const io = this.bytes(pid)
      if (io) this.baseline.set(pid, io)
    }
  }

  private extraSinceReport(): ProcessIo {
    const extra = { read: 0, write: 0 }
    if (!this.pid) return extra
    for (const pid of this.pids(this.pid)) {
      const io = this.bytes(pid)
      if (!io) continue
      const base = this.baseline.get(pid)
      if (!base) {
        this.baseline.set(pid, io)
        continue
      }
      extra.read += Math.max(0, io.read - base.read)
      extra.write += Math.max(0, io.write - base.write)
    }
    return extra
  }

  private snapshot(
    written: number,
    diskSpeed: number,
    eta: string,
    readSpeed: number
  ): InstallProgress {
    this.lastDisplayed = written
    const percent = Math.round((written / this.total) * 10000) / 100
    return {
      bytes: `${formatByteSize(written)} / ${formatByteSize(this.total)}`,
      eta,
      percent,
      diskSpeed,
      downSpeed: this.loggedDownSpeed,
      readSpeed,
      writtenBytes: written,
      totalBytes: this.total
    }
  }
}

// Decides whether Galaxy Common Redistributables actually need another download.

interface RedistDepotSnapshot {
  dependencyId: string
  executable?: { path?: string }
}

export interface RedistManifestSnapshot {
  depots?: RedistDepotSnapshot[]
  build_id?: string
  HGLInstalled?: string[]
}

interface RedistDecision {
  update: boolean
  installed: string[]
}

function sharedRedistIds(
  manifest: RedistManifestSnapshot,
  requiredIds: string[]
): string[] {
  const depots = manifest.depots ?? []
  const ids: string[] = []
  for (const id of requiredIds) {
    const depot = depots.find((dep) => dep.dependencyId === id)
    if (depot?.executable?.path?.startsWith('__redist') && !ids.includes(id)) {
      ids.push(id)
    }
  }
  return ids
}

export function sameRedistIds(
  recorded: string[] | undefined,
  installed: string[]
): boolean {
  if (!recorded || recorded.length !== installed.length) {
    return false
  }
  const left = [...recorded].sort()
  const right = [...installed].sort()
  return left.every((id, index) => id === right[index])
}

export function assessRedistManifest(
  manifest: RedistManifestSnapshot | undefined,
  requiredIds: string[],
  remoteBuildId?: string
): RedistDecision {
  if (!manifest) {
    return { update: true, installed: [] }
  }

  const installed = sharedRedistIds(manifest, requiredIds)
  const buildChanged =
    !!remoteBuildId &&
    !!manifest.build_id &&
    manifest.build_id !== remoteBuildId

  // gogdl already wrote these packages into the manifest, but Heroic never
  // stored HGLInstalled. Treating that as "not installed" queued the same
  // download on every launch and every game update.
  if (!manifest.HGLInstalled) {
    return { update: buildChanged, installed }
  }

  return {
    update: buildChanged || !sameRedistIds(manifest.HGLInstalled, installed),
    installed
  }
}

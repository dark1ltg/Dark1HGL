import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAdd,
  faCheck,
  faSpinner,
  faTrash,
  faXmark
} from '@fortawesome/free-solid-svg-icons'

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import { ToggleSwitch } from 'frontend/components/UI'
import LibraryContext from '../../LibraryContext'
import type {
  GOGBatchImportResult,
  GOGLibraryFolder,
  GOGScanResult
} from 'common/types/gog'
import './index.css'

const isActionable = (game: GOGScanResult) =>
  game.status === 'importable' || game.status === 'moved'

export default function GogAutoImport() {
  const { t } = useTranslation()
  const { setShowGogAutoImport } = useContext(LibraryContext)

  const [folders, setFolders] = useState<GOGLibraryFolder[]>([])
  const [autoImport, setAutoImport] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<GOGScanResult[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [activePath, setActivePath] = useState<string>()
  const [importTotal, setImportTotal] = useState(0)
  const [importResult, setImportResult] = useState<GOGBatchImportResult>()

  useEffect(() => {
    let cancelled = false
    const refreshFolders = () => {
      void window.api.getGogLibraryFolders().then((next) => {
        if (!cancelled) setFolders(next)
      })
    }
    refreshFolders()
    const timer = setInterval(refreshFolders, 3000)
    void window.api.requestAppSettings().then((settings) => {
      if (!cancelled) setAutoImport(!!settings.gogAutoImportEnabled)
    })
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(
    () =>
      window.api.handleGogAutoImportProgress((_event, progress) => {
        if (progress.phase === 'active') {
          setActivePath(progress.path)
          return
        }
        setActivePath((current) =>
          current === progress.path ? undefined : current
        )
        setImportResult((current) => {
          const imported = current?.imported ?? []
          const failed = current?.failed ?? []
          if (progress.phase === 'done') {
            return {
              imported: imported.includes(progress.path)
                ? imported
                : [...imported, progress.path],
              failed
            }
          }
          return {
            imported,
            failed: failed.includes(progress.path)
              ? failed
              : [...failed, progress.path]
          }
        })
      }),
    []
  )

  const close = () => setShowGogAutoImport(false)

  const addFolder = async () => {
    const path = await window.api.openDialog({
      buttonLabel: t('box.choose', 'Choose'),
      properties: ['openDirectory'],
      title: t('gog-auto-import.select-folder', 'Select a folder with games')
    })
    if (path) setFolders(await window.api.addGogLibraryFolder(path))
  }

  const removeFolder = async (path: string) => {
    setFolders(await window.api.removeGogLibraryFolder(path))
  }

  const toggleAutoImport = () => {
    const value = !autoImport
    setAutoImport(value)
    window.api.setSetting({
      appName: 'default',
      key: 'gogAutoImportEnabled',
      value
    })
  }

  const scan = async () => {
    setScanning(true)
    setImportResult(undefined)
    setImportTotal(0)
    const found = await window.api.scanForGogGames(
      folders.filter((folder) => folder.available).map(({ path }) => path)
    )
    setResults(found)
    const picked = new Set<string>()
    const pickedApps = new Set<string>()
    for (const game of found) {
      if (!isActionable(game) || pickedApps.has(game.appName)) continue
      pickedApps.add(game.appName)
      picked.add(game.path)
    }
    setSelected(picked)
    setScanning(false)
  }

  const toggleSelected = (game: GOGScanResult) => {
    const next = new Set(selected)
    if (next.has(game.path)) {
      next.delete(game.path)
    } else {
      for (const other of results ?? []) {
        if (other.appName === game.appName) next.delete(other.path)
      }
      next.add(game.path)
    }
    setSelected(next)
  }

  const importSelected = async () => {
    if (!results) return
    setImporting(true)
    setActivePath(undefined)
    setImportResult(undefined)
    const toImport = results
      .filter((game) => selected.has(game.path))
      .map(({ appName, path, platform }) => ({ appName, path, platform }))
    setImportTotal(toImport.length)
    setImportResult(await window.api.importGogGames(toImport))
    setActivePath(undefined)
    setSelected(new Set())
    setImporting(false)
  }

  const importedCount = importResult?.imported.length ?? 0
  const selectedCount =
    importing || (importTotal > 0 && selected.size === 0)
      ? importTotal
      : selected.size

  const statusLabel = (game: GOGScanResult) => {
    if (activePath === game.path) {
      return t('gog-auto-import.status.importing', 'Importing…')
    }
    const status = game.status
    switch (status) {
      case 'installed':
        return t('gog-auto-import.status.installed', 'Already in Heroic')
      case 'moved':
        return t('gog-auto-import.status.moved', 'Moved, will be re-linked')
      case 'notOwned':
        return t('gog-auto-import.status.not-owned', 'Not in your GOG account')
      case 'unsupportedPlatform':
        return t(
          'gog-auto-import.status.unsupported',
          'Not supported on this OS'
        )
      default:
        return t('gog-auto-import.status.importable', 'Ready to import')
    }
  }

  const rowState = (game: GOGScanResult) => {
    if (activePath === game.path) {
      return <FontAwesomeIcon className="fa-spin-pulse" icon={faSpinner} />
    }
    if (importResult?.imported.includes(game.path)) {
      return <FontAwesomeIcon className="GogAutoImport__ok" icon={faCheck} />
    }
    if (importResult?.failed.includes(game.path)) {
      return <FontAwesomeIcon className="GogAutoImport__fail" icon={faXmark} />
    }
    return (
      <input
        type="checkbox"
        aria-label={game.title}
        disabled={!isActionable(game) || importing}
        checked={selected.has(game.path)}
        onChange={() => toggleSelected(game)}
      />
    )
  }

  return (
    <Dialog showCloseButton onClose={close} className="GogAutoImport__Dialog">
      <DialogHeader onClose={close}>
        {t('gog-auto-import.title', 'Import installed GOG games')}
      </DialogHeader>
      <DialogContent>
        <p className="GogAutoImport__hint">
          {t(
            'gog-auto-import.description',
            'Add the folders or drives where your GOG games are installed. Heroic scans everything inside them and imports every game it finds that is in your GOG account. Like Steam library folders, they are remembered even on external drives.'
          )}
        </p>

        <div className="GogAutoImport__folders">
          {folders.map(({ path, available }) => (
            <div className="GogAutoImport__folder" key={path}>
              <span title={path}>{path}</span>
              <span
                className={
                  available ? 'GogAutoImport__online' : 'GogAutoImport__offline'
                }
              >
                {available
                  ? t('gog-auto-import.connected', 'Connected')
                  : t('gog-auto-import.disconnected', 'Drive not connected')}
              </span>
              <button
                className="button is-danger"
                title={t('gog-auto-import.remove-folder', 'Remove folder')}
                disabled={scanning || importing}
                onClick={() => void removeFolder(path)}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          ))}
          <button
            className="button is-secondary"
            onClick={() => void addFolder()}
            disabled={scanning || importing}
          >
            <FontAwesomeIcon icon={faAdd} />{' '}
            {t('gog-auto-import.add-folder', 'Add folder')}
          </button>
        </div>

        <ToggleSwitch
          htmlId="gogAutoImportEnabled"
          value={autoImport}
          handleChange={toggleAutoImport}
          title={t(
            'gog-auto-import.automatic',
            'Import games automatically when Heroic starts or a drive with a library folder is connected'
          )}
        />

        {results && (
          <div className="GogAutoImport__summary">
            <h6>
              {t(
                'gog-auto-import.found-selected',
                '{{found}} games found, {{selected}} selected',
                { found: results.length, selected: selectedCount }
              )}
            </h6>
            {importTotal > 0 && (
              <p className="GogAutoImport__progress">
                {t(
                  'gog-auto-import.progress',
                  '{{done}} of {{total}} imported',
                  { done: importedCount, total: importTotal }
                )}
              </p>
            )}
          </div>
        )}

        {results && (
          <div className="GogAutoImport__results">
            {results.map((game) => (
              <div
                className={
                  activePath === game.path
                    ? 'GogAutoImport__row GogAutoImport__row--active'
                    : 'GogAutoImport__row'
                }
                key={game.path}
              >
                <span className="GogAutoImport__state">{rowState(game)}</span>
                <span className="GogAutoImport__title">{game.title}</span>
                <span className="GogAutoImport__status">
                  {statusLabel(game)}
                </span>
                <span className="GogAutoImport__path" title={game.path}>
                  {game.path}
                </span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        <button
          className="button is-secondary"
          onClick={() => void scan()}
          disabled={
            !folders.some((folder) => folder.available) || scanning || importing
          }
        >
          {scanning && (
            <FontAwesomeIcon className="fa-spin-pulse" icon={faSpinner} />
          )}{' '}
          {t('gog-auto-import.scan', 'Scan')}
        </button>
        <button
          className="button is-primary"
          onClick={() => void importSelected()}
          disabled={!selected.size || scanning || importing}
        >
          {importing
            ? t('gog-auto-import.progress', '{{done}} of {{total}} imported', {
                done: importedCount,
                total: importTotal
              })
            : t('gog-auto-import.import', 'Import {{count}} game(s)', {
                count: selected.size
              })}
        </button>
      </DialogFooter>
    </Dialog>
  )
}

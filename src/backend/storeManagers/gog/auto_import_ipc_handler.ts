import { addHandler } from 'backend/ipc'
import { importGogGames, scanForGogGames } from './auto_import'
import {
  addLibraryFolder,
  listLibraryFolders,
  removeLibraryFolder
} from './library_folders'

addHandler('scanForGogGames', async (e, folders) => scanForGogGames(folders))

addHandler('importGogGames', async (e, games) => importGogGames(games))

addHandler('getGogLibraryFolders', () => listLibraryFolders())

addHandler('addGogLibraryFolder', async (e, path) => addLibraryFolder(path))

addHandler('removeGogLibraryFolder', async (e, path) =>
  removeLibraryFolder(path)
)

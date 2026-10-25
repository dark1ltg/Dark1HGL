import { addHandler } from 'backend/ipc'
import { importGogGames, scanForGogGames } from './auto_import'

addHandler('scanForGogGames', async (e, folders) => scanForGogGames(folders))

addHandler('importGogGames', async (e, games) => importGogGames(games))

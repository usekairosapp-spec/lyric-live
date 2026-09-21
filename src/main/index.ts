import { app, shell, screen, BrowserWindow, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { basename } from 'node:path'
import { join } from 'node:path'
import { is } from './lib/env'
import { IPC, type DisplayInfo, type LiveOverlayPayload, type LiveStatePayload } from '@shared/types/ipc'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerMediaHandlers } from './ipc/mediaHandlers'
import { registerLiveHandlers, type LiveWindowController } from './ipc/liveHandlers'
import { registerBibleHandlers } from './ipc/bibleHandlers'
import { registerSongHandlers } from './ipc/songHandlers'
import { registerHolyricsHandlers } from './ipc/holyricsHandlers'
import { registerTranscribeHandlers } from './ipc/transcribeHandlers'
import { buildAppMenu } from './menu'
import { registerFontHandlers } from './ipc/fontHandlers'
import { registerUpdateHandlers, startUpdateChecks } from './updater'
import { JsonProjectRepository } from './persistence/jsonProjectRepository'
import { mediaDirectory } from './persistence/mediaLibrary'

let liveWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let lastOverlay: LiveOverlayPayload | null = null

// empacotado, o ícone já vem do instalador; o png só existe no projeto em dev
const iconPath = join(__dirname, '../../build/icon.png')

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#121216',
    titleBarStyle: 'hiddenInset',
    title: 'Lyric Live',
    icon: app.isPackaged ? undefined : iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })
  win.on('ready-to-show', () => win.show())

  if (is.dev) {
    win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`)
    })
  }

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Janela de saída para projetor/segunda tela: só a cena, sem nenhuma UI do editor. */
function createLiveWindow(): void {
  if (liveWindow) {
    liveWindow.focus()
    return
  }

  // Com segundo monitor (projetor/telão) plugado, a janela vai sozinha pra ele em tela cheia.
  // Só com uma tela: abre em 1920×1080 (encolhe mantendo 16:9 se a tela for menor).
  const primaryId = screen.getPrimaryDisplay().id
  const external = screen.getAllDisplays().find((d) => d.id !== primaryId)

  if (external) {
    liveWindow = new BrowserWindow({
      x: external.bounds.x,
      y: external.bounds.y,
      width: external.bounds.width,
      height: external.bounds.height,
      show: false,
      backgroundColor: '#000000',
      frame: false,
      fullscreenable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false
      }
    })
    liveWindow.once('ready-to-show', () => liveWindow?.setFullScreen(true))
  } else {
    const work = screen.getPrimaryDisplay().workAreaSize
    const fit = Math.min(1, work.width / 1920, work.height / 1080)
    liveWindow = new BrowserWindow({
      width: Math.round(1920 * fit),
      height: Math.round(1080 * fit),
      useContentSize: true,
      center: true,
      show: false,
      backgroundColor: '#000000',
      frame: false,
      fullscreenable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false
      }
    })
  }

  liveWindow.on('ready-to-show', () => liveWindow?.show())
  liveWindow.webContents.on('did-finish-load', () => {
    if (lastOverlay) liveWindow?.webContents.send(IPC.liveOverlay, lastOverlay)
  })
  liveWindow.on('closed', () => {
    liveWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    liveWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/live.html`)
  } else {
    liveWindow.loadFile(join(__dirname, '../renderer/live.html'))
  }
}

const liveController: LiveWindowController = {
  open: () => createLiveWindow(),
  close: () => liveWindow?.close(),
  isOpen: () => !!liveWindow,
  pushState: (payload: LiveStatePayload) => liveWindow?.webContents.send(IPC.liveState, payload),
  pushOverlay: (payload: LiveOverlayPayload | null) => {
    lastOverlay = payload
    liveWindow?.webContents.send(IPC.liveOverlay, payload)
  },
  listDisplays: (): DisplayInfo[] => {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Tela ${i + 1}${d.id === primaryId ? ' (principal)' : ''} — ${d.bounds.width}×${d.bounds.height}`,
      isPrimary: d.id === primaryId,
      width: d.bounds.width,
      height: d.bounds.height
    }))
  },
  moveToDisplay: (displayId: number) => {
    if (!liveWindow) return
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) return
    liveWindow.setFullScreen(false)
    liveWindow.setBounds(display.bounds)
    liveWindow.setFullScreen(true)
  },
  exitFullscreen: () => liveWindow?.setFullScreen(false)
}

app.setName('Lyric Live')

// lyricmedia://media/<arquivo>: serve imagens/vídeos da pasta de mídia do app com
// streaming (dá pra buscar/loop em vídeo grande sem carregar tudo em memória).
protocol.registerSchemesAsPrivileged([
  { scheme: 'lyricmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

app.whenReady().then(() => {
  buildAppMenu(() => mainWindow)

  protocol.handle('lyricmedia', (request) => {
    const name = basename(decodeURIComponent(new URL(request.url).pathname))
    return net.fetch(pathToFileURL(join(mediaDirectory(), name)).toString(), { headers: request.headers })
  })

  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(iconPath)
  }

  registerProjectHandlers(new JsonProjectRepository())
  registerMediaHandlers()
  registerLiveHandlers(liveController)
  registerBibleHandlers()
  registerSongHandlers()
  registerHolyricsHandlers()
  registerTranscribeHandlers()
  registerFontHandlers()
  registerUpdateHandlers(() => mainWindow)

  createMainWindow()
  startUpdateChecks(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

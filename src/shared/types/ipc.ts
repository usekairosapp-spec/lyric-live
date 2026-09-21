import type { EffectId, Project, Scene } from './project'
import type { PhraseLayout } from './phrase'
import type { WordFontStyle } from './song'

/** Nomes de canal IPC centralizados para evitar strings soltas nos dois lados. */
export const IPC = {
  projectSave: 'project:save',
  projectSaveAs: 'project:saveAs',
  projectOpen: 'project:open',
  mediaImportAudio: 'media:importAudio',
  mediaReadFile: 'media:readFile',
  mediaImportVisual: 'media:importVisual',
  liveOpen: 'live:open',
  liveClose: 'live:close',
  liveIsOpen: 'live:isOpen',
  liveListDisplays: 'live:listDisplays',
  liveMoveToDisplay: 'live:moveToDisplay',
  liveExitFullscreen: 'live:exitFullscreen',
  livePushState: 'live:pushState',
  liveState: 'live:state',
  livePushOverlay: 'live:pushOverlay',
  liveOverlay: 'live:overlay',
  bibleListVersions: 'bible:listVersions',
  bibleDownloadVersion: 'bible:downloadVersion',
  bibleReadVersion: 'bible:readVersion',
  bibleDeleteVersion: 'bible:deleteVersion',
  bibleImportVersion: 'bible:importVersion',
  holyricsGetSettings: 'holyrics:getSettings',
  holyricsSaveSettings: 'holyrics:saveSettings',
  holyricsTestConnection: 'holyrics:testConnection',
  holyricsListSongs: 'holyrics:listSongs',
  holyricsImportSongs: 'holyrics:importSongs',
  songList: 'song:list',
  songSave: 'song:save',
  songRead: 'song:read',
  songDelete: 'song:delete',
  songSearchOnline: 'song:searchOnline',
  songFetchLyrics: 'song:fetchLyrics',
  playlistGet: 'playlist:get',
  playlistSave: 'playlist:save',
  appCommand: 'app:command',
  fontsList: 'fonts:list',
  transcribeRun: 'transcribe:run',
  transcribeProgress: 'transcribe:progress',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateOpenPage: 'update:openPage',
  updateAvailable: 'update:available',
  updateProgress: 'update:progress'
} as const

/** Comandos do menu do app (atalhos Ctrl/⌘+…) que o processo principal manda pro editor. */
export type AppCommand = 'undo' | 'redo' | 'save' | 'saveAs' | 'open' | 'new' | 'checkUpdates'

/** Versão nova publicada no GitHub. `assetUrl` é nulo se não há instalador pro sistema atual. */
export interface UpdateInfo {
  version: string
  notes: string
  assetName: string | null
  assetUrl: string | null
  size: number
  pageUrl: string
}

export interface UpdateCheckResult {
  info: UpdateInfo | null
  error?: string
}

export interface UpdateProgress {
  received: number
  total: number
}

export interface ProjectFileResult {
  project: Project
  filePath: string
}

/** Resultado de escolher e copiar um arquivo de áudio para a pasta de mídia do app.
 * A duração é calculada depois, no renderer, ao decodificar o arquivo. */
export interface ImportedAudioFile {
  filePath: string
  fileName: string
}

/** O que o editor manda pra janela LIVE mostrar. */
export interface LiveStatePayload {
  scene: Scene
  playhead: number
}

/** Texto em exibição ao vivo direto da Bíblia ou de uma música — não faz parte
 * da cena/timeline do projeto, é só um overlay temporário que a janela LIVE
 * mostra por cima (tela cheia, sem UI do editor). */
export interface LiveOverlayPayload {
  text: string
  reference: string
  /** Animação de entrada do texto (mesmos presets da aba Efeitos). */
  effect?: EffectId | null
  /** Palavras (índice entre as não-vazias) destacadas com brilho pulsante. */
  highlights?: number[]
  /** Fonte/cor/tamanho por palavra do texto simples. */
  wordStyles?: Record<number, WordFontStyle>
  /** Efeito só de algumas palavras do texto simples. */
  wordEffects?: Record<number, EffectId>
  /** Frase estilizada: quando presente, é desenhada no lugar do texto simples. */
  phrase?: PhraseLayout | null
  /** Multiplicador do tamanho da letra (1 = padrão). */
  fontScale?: number
  /** Muda a cada "replay" — é o que faz a animação de entrada tocar de novo. */
  key?: number
}

export interface DisplayInfo {
  id: number
  label: string
  isPrimary: boolean
  width: number
  height: number
}

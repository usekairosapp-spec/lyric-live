/** Onde encontrar: no Holyrics, menu Arquivo > Configurações > API Server —
 * ative o servidor e gere um token em "gerenciar permissões". Host/porta são
 * os mesmos mostrados ali (geralmente o IP do PC que roda o Holyrics). */
export interface HolyricsSettings {
  host: string
  port: number
  token: string
}

export interface HolyricsSongSummary {
  id: string
  title: string
  artist: string
}

export interface HolyricsImportSongsResult {
  imported: number
  failed: string[]
}

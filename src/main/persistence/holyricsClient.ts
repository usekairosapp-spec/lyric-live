import type { HolyricsSettings } from '@shared/types/holyrics'

interface HolyricsResponse<T> {
  status: 'ok' | 'error'
  data?: T
  error?: string
}

/**
 * Chama a API local do Holyrics (Arquivo > Configurações > API Server).
 * Doc: https://github.com/holyrics/API-Server — POST em /api/{action}?token=...
 */
export async function callHolyrics<T = unknown>(
  settings: HolyricsSettings,
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const url = `http://${settings.host}:${settings.port}/api/${action}?token=${encodeURIComponent(settings.token)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000)
    })
  } catch {
    throw new Error(
      `Não consegui conectar em ${settings.host}:${settings.port}. Confira se o Holyrics está aberto e com o API Server ativado.`
    )
  }
  if (!res.ok) throw new Error(`Holyrics respondeu HTTP ${res.status} — confira o token.`)
  const json = (await res.json()) as HolyricsResponse<T>
  if (json.status !== 'ok') throw new Error(json.error ?? 'Erro desconhecido na API do Holyrics.')
  return json.data as T
}

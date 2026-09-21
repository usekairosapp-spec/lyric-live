import { useEffect, useMemo, useState } from 'react'
import type { HolyricsSettings, HolyricsSongSummary } from '@shared/types/holyrics'

const EMPTY_SETTINGS: HolyricsSettings = { host: 'localhost', port: 8091, token: '' }

/**
 * Importa músicas do Holyrics via API local (Arquivo > Configurações > API
 * Server, no Holyrics — ativa o servidor e gera um token ali). Guarda
 * host/porta/token pra não pedir de novo da próxima vez.
 */
export function HolyricsImportModal({
  onCancel,
  onImported
}: {
  onCancel: () => void
  onImported: () => void
}) {
  const [settings, setSettings] = useState<HolyricsSettings>(EMPTY_SETTINGS)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [songs, setSongs] = useState<HolyricsSongSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null)

  useEffect(() => {
    window.api?.holyrics.getSettings().then((saved) => {
      if (saved) setSettings(saved)
    })
  }, [])

  const filteredSongs = useMemo(() => {
    if (!songs) return []
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
  }, [songs, query])

  const allFilteredSelected = filteredSongs.length > 0 && filteredSongs.every((s) => selected.has(s.id))

  const handleConnect = async (): Promise<void> => {
    if (!window.api) return
    setConnecting(true)
    setConnectError(null)
    try {
      await window.api.holyrics.testConnection(settings)
      await window.api.holyrics.saveSettings(settings)
      const list = await window.api.holyrics.listSongs(settings)
      setSongs(list)
      setConnected(true)
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err)
      )
    } finally {
      setConnecting(false)
    }
  }

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllFiltered = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filteredSongs.forEach((s) => next.delete(s.id))
      else filteredSongs.forEach((s) => next.add(s.id))
      return next
    })
  }

  const handleImport = async (): Promise<void> => {
    if (!window.api || selected.size === 0) return
    setImporting(true)
    try {
      const res = await window.api.holyrics.importSongs(settings, [...selected])
      setResult({ imported: res.imported, failed: res.failed.length })
      onImported()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6">
      <div className="flex h-full max-h-[600px] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="border-b border-surface-800 px-4 py-3">
          <div className="text-sm font-semibold text-neutral-100">Importar músicas do Holyrics</div>
          <p className="mt-1 text-xs leading-snug text-neutral-500">
            No Holyrics: Arquivo → Configurações → API Server. Ative o servidor, gere um token em
            “gerenciar permissões” e use o host/porta mostrados ali (o padrão é o próprio computador, porta
            8091).
          </p>
        </div>

        {!connected ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-scroll p-4">
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div>
                <div className="field-label mb-1">Host</div>
                <input
                  value={settings.host}
                  onChange={(e) => setSettings((s) => ({ ...s, host: e.target.value }))}
                  className="field-input w-full"
                  placeholder="localhost ou IP do PC com Holyrics"
                />
              </div>
              <div>
                <div className="field-label mb-1">Porta</div>
                <input
                  type="number"
                  value={settings.port}
                  onChange={(e) => setSettings((s) => ({ ...s, port: Number(e.target.value) || 0 }))}
                  className="field-input w-full"
                />
              </div>
            </div>
            <div>
              <div className="field-label mb-1">Token</div>
              <input
                value={settings.token}
                onChange={(e) => setSettings((s) => ({ ...s, token: e.target.value }))}
                className="field-input w-full"
                placeholder="Gerado em API Server → gerenciar permissões"
              />
            </div>
            {connectError && <p className="text-xs text-red-400">{connectError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-surface-800">
                Cancelar
              </button>
              <button
                onClick={handleConnect}
                disabled={connecting || !settings.host || !settings.port || !settings.token}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {connecting ? 'Conectando…' : 'Conectar'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-surface-800 px-4 py-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar por título ou artista..."
                className="field-input flex-1"
              />
              <button
                onClick={toggleSelectAllFiltered}
                className="rounded-md border border-surface-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-surface-800"
              >
                {allFilteredSelected ? 'Desmarcar tudo' : 'Marcar tudo'}
              </button>
            </div>
            <div className="flex-1 overflow-y-scroll">
              {songs === null ? (
                <div className="p-4 text-sm text-neutral-600">Carregando…</div>
              ) : filteredSongs.length === 0 ? (
                <div className="p-4 text-sm text-neutral-600">Nenhuma música encontrada.</div>
              ) : (
                filteredSongs.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-surface-800/60 px-4 py-2 hover:bg-surface-800"
                  >
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-neutral-100">{s.title}</div>
                      <div className="truncate text-xs text-neutral-500">{s.artist}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-surface-800 px-4 py-3">
              <span className="text-xs text-neutral-500">
                {result
                  ? `${result.imported} importada(s)${result.failed ? `, ${result.failed} falharam` : ''}.`
                  : `${selected.size} selecionada(s)`}
              </span>
              <div className="flex gap-2">
                <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-surface-800">
                  {result ? 'Fechar' : 'Cancelar'}
                </button>
                {!result && (
                  <button
                    onClick={handleImport}
                    disabled={importing || selected.size === 0}
                    className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    {importing ? 'Importando…' : `Importar ${selected.size || ''}`}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

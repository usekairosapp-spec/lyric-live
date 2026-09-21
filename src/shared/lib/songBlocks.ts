/** Divide a letra em blocos de 2 linhas (versos), sem atravessar a separação
 * de estrofes (linha em branco). Sobra de 1 linha no fim da estrofe entra no
 * bloco anterior; estrofes curtas (até 3 linhas) ficam inteiras. É idempotente:
 * dividir de novo blocos já divididos devolve os mesmos blocos. */
export function splitIntoBlocks(lyrics: string): string[] {
  const stanzas = lyrics
    .split(/\n\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    )
    .filter((lines) => lines.length > 0)

  const blocks: string[] = []
  for (const lines of stanzas) {
    if (lines.length <= 3) {
      blocks.push(lines.join('\n'))
      continue
    }
    const chunks: string[][] = []
    for (let i = 0; i < lines.length; i += 2) chunks.push(lines.slice(i, i + 2))
    if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) {
      const last = chunks.pop()!
      chunks[chunks.length - 1].push(...last)
    }
    for (const c of chunks) blocks.push(c.join('\n'))
  }
  return blocks
}

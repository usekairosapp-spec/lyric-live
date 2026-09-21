const MAX_CHARS_PER_LINE = 45

/** Quebra um texto em linhas de até `maxChars`, cortando só nos espaços (nunca no meio de uma palavra). */
function wrapLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Versículos não têm quebra de linha própria (ao contrário de letras de música), então
 * quebramos pelo tamanho da linha e agrupamos de 2 em 2 — mesma ideia de `splitIntoBlocks`,
 * pra caber na tela igual um slide de música em vez de estourar em várias linhas. */
export function splitVerseIntoSlides(text: string, maxCharsPerLine = MAX_CHARS_PER_LINE): string[] {
  const lines = wrapLines(text, maxCharsPerLine)
  if (lines.length === 0) return ['']
  const slides: string[] = []
  for (let i = 0; i < lines.length; i += 2) {
    slides.push(lines.slice(i, i + 2).join('\n'))
  }
  return slides
}

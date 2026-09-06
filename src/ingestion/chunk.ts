export interface Chunk {
  chunkIndex: number;
  content: string;
  pageNumber: number;
}

const TARGET_WORDS_PER_CHUNK = 180;
const WORDS_PER_PAGE = 400; // approximate — these are plain-text synthetic contracts, not real PDFs

export function chunkText(text: string): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentWordCount = 0;
  let wordsSoFar = 0;
  let chunkIndex = 0;

  const flush = () => {
    if (current.length === 0) return;
    const pageNumber = Math.floor(wordsSoFar / WORDS_PER_PAGE) + 1;
    chunks.push({ chunkIndex: chunkIndex++, content: current.join('\n\n'), pageNumber });
    wordsSoFar += currentWordCount;
    current = [];
    currentWordCount = 0;
  };

  for (const paragraph of paragraphs) {
    const wordCount = paragraph.split(/\s+/).length;
    if (currentWordCount > 0 && currentWordCount + wordCount > TARGET_WORDS_PER_CHUNK) {
      flush();
    }
    current.push(paragraph);
    currentWordCount += wordCount;
  }
  flush();

  return chunks;
}

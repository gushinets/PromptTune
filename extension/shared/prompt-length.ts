// Match Python len(str): count Unicode code points without allocating an array.
export function countPromptCharacters(text: string): number {
  let count = 0;
  for (const character of text) {
    void character;
    count++;
  }
  return count;
}

export function formatCharacterCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function parseInputLengthError(message: string): number | null {
  const match = /Input text exceeds maximum length of (\d+) characters\./i.exec(message);
  const limit = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

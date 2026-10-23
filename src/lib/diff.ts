export type DiffSegment = { type: 'equal' | 'added' | 'removed'; value: string };

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ type: 'removed', value: a[i] });
      i++;
    } else {
      raw.push({ type: 'added', value: b[j] });
      j++;
    }
  }
  while (i < m) {
    raw.push({ type: 'removed', value: a[i] });
    i++;
  }
  while (j < n) {
    raw.push({ type: 'added', value: b[j] });
    j++;
  }

  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      last.value += seg.value;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

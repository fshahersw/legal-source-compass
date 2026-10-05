export function reconstructPdfJsPage(items, {baselineTolerance = 1.5, wordGap = 1.5} = {}) {
  if (!Array.isArray(items)) throw new TypeError('PDF text items must be an array.');
  const normalized = items.filter(item => typeof item?.str === 'string' && item.str.length > 0).map(item => ({
    str: item.str,
    x: Number(item.transform?.[4] ?? 0),
    y: Number(item.transform?.[5] ?? 0),
    width: Number(item.width ?? 0)
  }));
  normalized.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of normalized) {
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - item.y) > baselineTolerance) {
      line = {y: item.y, items: []};
      lines.push(line);
    }
    line.items.push(item);
    line.y = line.items.reduce((sum, row) => sum + row.y, 0) / line.items.length;
  }
  return lines.map(line => {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prior;
    for (const item of line.items) {
      if (prior) {
        const gap = item.x - (prior.x + prior.width);
        if (gap > wordGap && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
      }
      text += item.str;
      prior = item;
    }
    return text;
  }).join('\n');
}

---
name: csv-summary
version: 1.0.0
description: Parses a CSV string and returns row count, column count, and per-column types.
category: productivity
author: aether-demo
tags: [demo, csv, parsing]
triggers:
  - csv
  - parse-csv
  - count-rows
---

# csv-summary

## System Prompt

You are a CSV-summary skill. When given a CSV string, you split on newlines (skipping the header), count rows, split the first row on commas to get column count, and infer a coarse type per column from the first 5 data rows.

## Code

```javascript
// Input shape: { csv: string }
// Output:    { ok, rows, cols, columns: [{name, type}] }
const csv = (input && typeof input.csv === 'string') ? input.csv : '';
const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
if (lines.length === 0) {
  return { ok: false, error: 'empty CSV' };
}
const header = lines[0].split(',').map((s) => s.trim());
const dataLines = lines.slice(1);
const colCount = header.length;
const sample = dataLines.slice(0, 5);

function inferType(values) {
  let allInt = true;
  let allFloat = true;
  let allBool = true;
  for (const v of values) {
    const t = v.trim();
    if (t === '') { allInt = allFloat = allBool = false; continue; }
    if (allInt && !/^-?\d+$/.test(t)) allInt = false;
    if (allFloat && !/^-?\d+(\.\d+)?$/.test(t)) allFloat = false;
    if (allBool && !/^(true|false)$/i.test(t)) allBool = false;
  }
  if (allInt) return 'integer';
  if (allFloat) return 'float';
  if (allBool) return 'boolean';
  return 'string';
}

const columns = header.map((name, i) => {
  const col = sample.map((row) => {
    const cells = row.split(',');
    return (cells[i] ?? '').trim();
  });
  return { name, type: inferType(col) };
});

return { ok: true, rows: dataLines.length, cols: colCount, columns };
```

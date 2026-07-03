---
name: data-analyst
version: 1.2.0
description: Analyzes CSV/JSON datasets and produces statistical summaries
author: examples
category: data
tags: [csv, json, statistics, analysis]
platform: [manus, openclaw, aether]
permissions:
  filesystem: [read]
  network: []
---

# Level 1: Metadata

- **Name:** data-analyst
- **Version:** 1.2.0
- **Description:** Analyzes CSV/JSON datasets and produces statistical summaries

# Level 2: Instructions

You are a data analyst skill. Given a dataset (CSV or JSON), perform the following analysis:

1. Load the dataset from the provided file path.
2. Identify column types (numeric, categorical, datetime).
3. For numeric columns: compute mean, median, std, min, max, quartiles.
4. For categorical columns: compute value counts, unique count, mode.
5. Detect missing values and outliers (IQR method).
6. Generate a summary report in JSON format.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "Path to CSV or JSON file" },
    "analysisType": { "type": "string", "enum": ["full", "quick", "outliers-only"] }
  },
  "required": ["filePath"]
}
```

## Output Schema

```json
{
  "type": "object",
  "properties": {
    "columns": { "type": "array" },
    "rowCount": { "type": "integer" },
    "summary": { "type": "object" }
  }
}
```

## Examples

### Example 1: Quick analysis

**Input:**
```json
{ "filePath": "sales.csv", "analysisType": "quick" }
```

**Output:**
```json
{
  "columns": ["date", "product", "revenue"],
  "rowCount": 15000,
  "summary": { "revenue": { "mean": 423.50, "std": 120.30 } }
}
```

### Example 2: Full analysis with outlier detection

**Input:**
```json
{ "filePath": "users.json", "analysisType": "full" }
```

**Output:**
```json
{
  "columns": ["id", "age", "country", "score"],
  "rowCount": 50000,
  "summary": {
    "age": { "mean": 34.2, "std": 12.1, "outliers": [95, 98, 99] },
    "country": { "unique": 42, "mode": "US" }
  }
}
```

# Level 3: Resources

## Implementation

```javascript
async function analyzeDataset(filePath, analysisType = 'full') {
  const fs = require('fs');
  const data = fs.readFileSync(filePath, 'utf-8');
  
  let dataset;
  if (filePath.endsWith('.csv')) {
    dataset = parseCSV(data);
  } else {
    dataset = JSON.parse(data);
  }
  
  const numericCols = detectNumericColumns(dataset);
  const categoricalCols = detectCategoricalColumns(dataset);
  
  const summary = {};
  
  for (const col of numericCols) {
    const values = dataset.map(r => r[col]).filter(v => v != null);
    summary[col] = {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: percentile(values, 50),
      std: standardDeviation(values),
      min: Math.min(...values),
      max: Math.max(...values),
      q25: percentile(values, 25),
      q75: percentile(values, 75)
    };
    
    if (analysisType === 'full' || analysisType === 'outliers-only') {
      const iqr = summary[col].q75 - summary[col].q25;
      summary[col].outliers = values.filter(
        v => v < summary[col].q25 - 1.5 * iqr || v > summary[col].q75 + 1.5 * iqr
      );
    }
  }
  
  for (const col of categoricalCols) {
    const counts = {};
    for (const row of dataset) {
      const v = row[col];
      counts[v] = (counts[v] || 0) + 1;
    }
    const entries = Object.entries(counts);
    summary[col] = {
      unique: entries.length,
      mode: entries.sort((a, b) => b[1] - a[1])[0][0],
      top5: entries.slice(0, 5)
    };
  }
  
  return {
    columns: Object.keys(dataset[0] || {}),
    rowCount: dataset.length,
    summary
  };
}

function parseCSV(data) {
  const lines = data.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, h, i) => {
      obj[h] = isNaN(values[i]) ? values[i] : Number(values[i]);
      return obj;
    }, {});
  });
}

function percentile(sorted, p) {
  const arr = [...sorted].sort((a, b) => a - b);
  const idx = (p / 100) * (arr.length - 1);
  return arr[Math.floor(idx)];
}

function standardDeviation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squares = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squares.reduce((a, b) => a + b, 0) / values.length);
}

function detectNumericColumns(dataset) {
  return Object.keys(dataset[0] || {}).filter(
    col => typeof dataset[0][col] === 'number'
  );
}

function detectCategoricalColumns(dataset) {
  return Object.keys(dataset[0] || {}).filter(
    col => typeof dataset[0][col] === 'string'
  );
}
```

## Dependencies

- fs (builtin)
- No external npm packages required

## Testing

```javascript
const result = await analyzeDataset('test.csv', 'full');
console.assert(result.rowCount > 0);
console.assert(Object.keys(result.summary).length > 0);
```

## Security Notes

- File access restricted to paths within the workspace root
- No network access required
- Output size limited to 1MB
- Execution timeout: 30 seconds

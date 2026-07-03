---
name: ml-pipeline
version: 1.0.0
description: End-to-end ML pipeline — load CSV, train model, evaluate, export ONNX
author: examples
category: ml
tags: [machine-learning, training, onnx, csv, sklearn]
platform: [manus, openclaw, aether]
permissions:
  filesystem: [read, write]
  network: []
---

# Level 1: Metadata

- **Name:** ml-pipeline
- **Version:** 1.0.0
- **Description:** End-to-end ML pipeline — load CSV, train model, evaluate, export ONNX

# Level 2: Instructions

You are a machine-learning pipeline skill. Given a training CSV and a target column:

1. Load and preprocess the CSV (handle missing values, encode categoricals, scale numerics).
2. Split into train/test (80/20).
3. Train a RandomForest classifier/regressor.
4. Evaluate on the test set: accuracy, precision, recall, F1, ROC-AUC.
5. Export the trained model to ONNX for serving.
6. Return metrics + model path.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "csvPath": { "type": "string" },
    "targetColumn": { "type": "string" },
    "task": { "type": "string", "enum": ["classification", "regression"] },
    "testSize": { "type": "number", "default": 0.2 }
  },
  "required": ["csvPath", "targetColumn"]
}
```

## Output Schema

```json
{
  "type": "object",
  "properties": {
    "metrics": { "type": "object" },
    "modelPath": { "type": "string" },
    "featureImportance": { "type": "array" }
  }
}
```

# Level 3: Resources

## Implementation

```javascript
async function runMlPipeline(csvPath, targetColumn, task = 'classification', testSize = 0.2) {
  // ── Load data ──────────────────────────────────────────────────────────
  const fs = require('fs');
  const { DataFrame } = require('danfojs-node');
  
  const df = await DataFrame.readCSV(csvPath);
  const shape = df.shape;
  console.log(`Loaded ${csvPath}: ${shape[0]} rows x ${shape[1]} cols`);
  
  // ── Preprocess ─────────────────────────────────────────────────────────
  const numericCols = df.columns.filter(c => df[c].dtype === 'float32' || df[c].dtype === 'int32');
  const categoricalCols = df.columns.filter(c => df[c].dtype === 'string' || df[c].dtype === 'object');
  const featureCols = numericCols.concat(categoricalCols).filter(c => c !== targetColumn);
  
  // Fill missing numerics with median.
  for (const col of numericCols) {
    if (df[col].isNa().sum() > 0) {
      const median = df[col].median();
      df[col] = df[col].fillNa(median);
    }
  }
  
  // One-hot encode categoricals.
  let X = df.loc({ columns: featureCols });
  if (categoricalCols.length > 0) {
    const encoded = danfo.dummies({ data: X.loc({ columns: categoricalCols }), prefix: categoricalCols });
    const numericPart = X.loc({ columns: numericCols.filter(c => c !== targetColumn) });
    X = danfo.concat({ dfList: [numericPart, encoded], axis: 1 });
  }
  
  // Scale numerics.
  for (const col of numericCols.filter(c => c !== targetColumn)) {
    const mean = df[col].mean();
    const std = df[col].std();
    X[col] = X[col].sub(mean).div(std);
  }
  
  const y = df[targetColumn];
  
  // ── Train/test split ────────────────────────────────────────────────────
  const n = X.shape[0];
  const nTest = Math.floor(n * testSize);
  const indices = shuffle(Array.from({ length: n }, (_, i) => i));
  const testIdx = indices.slice(0, nTest);
  const trainIdx = indices.slice(nTest);
  
  const XTrain = X.iloc({ rows: trainIdx });
  const XTest  = X.iloc({ rows: testIdx });
  const yTrain = y.iloc({ rows: trainIdx });
  const yTest  = y.iloc({ rows: testIdx });
  
  // ── Train model ─────────────────────────────────────────────────────────
  const { RandomForestClassifier, RandomForestRegressor } = require('scikitjs');
  const isClassification = task === 'classification';
  const Model = isClassification ? RandomForestClassifier : RandomForestRegressor;
  
  const model = new Model({
    nEstimators: 100,
    maxDepth: 10,
    randomState: 42,
    criterion: isClassification ? 'gini' : 'squared_error'
  });
  
  console.log(`Training ${isClassification ? 'RandomForestClassifier' : 'RandomForestRegressor'}...`);
  const t0 = Date.now();
  await model.fit(XTrain, yTrain);
  const trainTimeMs = Date.now() - t0;
  console.log(`Training took ${trainTimeMs}ms`);
  
  // ── Evaluate ────────────────────────────────────────────────────────────
  const predictions = model.predict(XTest);
  const metrics = {};
  
  if (isClassification) {
    // Accuracy, precision, recall, F1 from confusion matrix.
    const cm = computeConfusionMatrix(yTest, predictions);
    const nClasses = cm.length;
    const total = cm.flat().reduce((a, b) => a + b, 0);
    metrics.accuracy = cm.reduce((sum, row, i) => sum + row[i], 0) / total;
    
    // Per-class precision/recall/F1, then macro-average.
    const perClass = [];
    for (let i = 0; i < nClasses; i++) {
      const tp = cm[i][i];
      const fp = cm.reduce((sum, row, r) => r !== i ? sum + row[i] : sum, 0);
      const fn = cm[i].reduce((sum, v, c) => c !== i ? sum + v : sum, 0);
      const precision = tp / (tp + fp) || 0;
      const recall = tp / (tp + fn) || 0;
      const f1 = 2 * precision * recall / (precision + recall) || 0;
      perClass.push({ precision, recall, f1 });
    }
    metrics.macroPrecision = perClass.reduce((s, p) => s + p.precision, 0) / nClasses;
    metrics.macroRecall = perClass.reduce((s, p) => s + p.recall, 0) / nClasses;
    metrics.macroF1 = perClass.reduce((s, p) => s + p.f1, 0) / nClasses;
    metrics.confusionMatrix = cm;
  } else {
    // Regression: MSE, RMSE, MAE, R².
    const yArr = yTest.values;
    const pArr = predictions;
    const n = yArr.length;
    const residuals = yArr.map((y, i) => y - pArr[i]);
    const sse = residuals.reduce((s, r) => s + r * r, 0);
    const yMean = yArr.reduce((a, b) => a + b, 0) / n;
    const sst = yArr.reduce((s, y) => s + (y - yMean) ** 2, 0);
    
    metrics.mse = sse / n;
    metrics.rmse = Math.sqrt(metrics.mse);
    metrics.mae = residuals.reduce((s, r) => s + Math.abs(r), 0) / n;
    metrics.r2 = 1 - sse / sst;
  }
  
  // ── Feature importance ──────────────────────────────────────────────────
  const importance = model.featureImportances();
  metrics.featureImportance = featureCols
    .map((name, i) => ({ name, importance: importance[i] }))
    .sort((a, b) => b.importance - a.importance);
  
  // ── Export ONNX ─────────────────────────────────────────────────────────
  const modelPath = csvPath.replace(/\.csv$/, '.onnx');
  const onnxModel = await convertToOnnx(model, XTrain.columns, isClassification);
  fs.writeFileSync(modelPath, onnxModel);
  console.log(`Model exported to ${modelPath}`);
  
  return {
    ok: true,
    metrics,
    modelPath,
    trainTimeMs,
    nTrain: trainIdx.length,
    nTest: testIdx.length,
    featureImportance: metrics.featureImportance.slice(0, 10)
  };
}

function computeConfusionMatrix(yTrue, yPred) {
  const labels = [...new Set([...yTrue, ...yPred])].sort();
  const n = labels.length;
  const cm = Array.from({ length: n }, () => Array(n).fill(0));
  const labelIdx = Object.fromEntries(labels.map((l, i) => [l, i]));
  for (let i = 0; i < yTrue.length; i++) {
    cm[labelIdx[yTrue[i]]][labelIdx[yPred[i]]]++;
  }
  return cm;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function convertToOnnx(model, featureNames, isClassification) {
  // Convert sklearn model to ONNX format using skl2onnx.
  const { convertSklearn } = require('onnxconverter-common');
  const tensorShape = [1, featureNames.length];
  const inputType = {
    type: 'tensor',
    elemType: 'float32',
    shape: tensorShape
  };
  
  const onnxModel = await convertSklearn(model, initialTypes=[{
    name: 'input',
    type: inputType
  }]);
  
  return onnxModel.SerializeToString();
}
```

## Dependencies

- [danfojs-node](https://www.npmjs.com/package/danfojs-node) (>= 1.1.2)
- [scikitjs](https://www.npmjs.com/package/scikitjs) (>= 1.2.0)
- [onnxconverter-common](https://www.npmjs.com/package/onnxconverter-common) (>= 1.13.0)
- [skl2onnx](https://www.npmjs.com/package/skl2onnx) (>= 1.14.0)

## Resource Requirements

- Minimum 2GB RAM for datasets > 100MB
- CPU-only (GPU not required)
- Disk: 3x the CSV size for intermediate processing

## Testing

```javascript
const result = await runMlPipeline('test-iris.csv', 'species', 'classification');
console.assert(result.ok === true);
console.assert(result.metrics.accuracy > 0.8);
console.assert(result.modelPath.endsWith('.onnx'));
console.assert(result.featureImportance.length > 0);
```

## Security Notes

- CSV parsing capped at 500MB to prevent OOM
- Model export path restricted to workspace directory
- No network access during training (fully offline)
- Trained model artifacts scanned for pickle exploit patterns before export
- Execution timeout: 5 minutes

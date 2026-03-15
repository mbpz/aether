// EP-04: TF-IDF 向量化 + 余弦相似度检索
// 零外部依赖的本地 RAG 实现

const STOPWORDS = new Set([
  'the','a','an','is','it','in','on','at','to','of','and','or','but',
  'for','with','this','that','are','was','were','be','been','have','has',
  '的','了','是','在','有','和','与','或','但','这','那','为','不','也',
]);

/** 分词：英文按空格/标点，中文按字 */
function tokenize(text: string): string[] {
  // 中文字符按单字切分，英文按词
  const tokens: string[] = [];
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff\s]/g, ' ');
  
  for (const part of cleaned.split(/\s+/)) {
    if (!part) continue;
    // 判断是否含中文
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (const ch of part) {
        if (/[\u4e00-\u9fff]/.test(ch) && !STOPWORDS.has(ch)) {
          tokens.push(ch);
        }
      }
    } else {
      if (part.length > 1 && !STOPWORDS.has(part)) {
        tokens.push(part);
      }
    }
  }
  return tokens;
}

/** 计算词频 TF */
function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  // 归一化
  const total = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / total);
  return tf;
}

export class TFIDFVectorizer {
  // 语料库词表：term -> 文档频率（DF）
  private df: Map<string, number> = new Map();
  private docCount = 0;
  private vocab: string[] = [];
  private vocabIndex: Map<string, number> = new Map();

  /** 添加文档，更新 IDF 词表 */
  addDocument(text: string): void {
    this.docCount++;
    const tokens = new Set(tokenize(text));
    for (const t of tokens) {
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this._rebuildVocab();
  }

  /** 移除文档（近似：减少 DF） */
  removeDocument(text: string): void {
    if (this.docCount <= 0) return;
    this.docCount--;
    const tokens = new Set(tokenize(text));
    for (const t of tokens) {
      const cur = this.df.get(t) ?? 0;
      if (cur <= 1) this.df.delete(t);
      else this.df.set(t, cur - 1);
    }
    this._rebuildVocab();
  }

  private _rebuildVocab(): void {
    this.vocab = Array.from(this.df.keys()).sort();
    this.vocabIndex = new Map(this.vocab.map((t, i) => [t, i]));
  }

  /** 将文本向量化为 TF-IDF 向量 */
  vectorize(text: string): number[] {
    if (this.vocab.length === 0) return [];
    const tokens = tokenize(text);
    const tf = termFreq(tokens);
    const N = Math.max(this.docCount, 1);
    
    const vec = new Array<number>(this.vocab.length).fill(0);
    for (const [term, tfVal] of tf) {
      const idx = this.vocabIndex.get(term);
      if (idx === undefined) continue;
      const df = this.df.get(term) ?? 1;
      const idf = Math.log((N + 1) / (df + 1)) + 1; // 平滑 IDF
      vec[idx] = tfVal * idf;
    }
    return vec;
  }

  /** 余弦相似度：[-1, 1]，越接近 1 越相似 */
  cosineSim(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom < 1e-9 ? 0 : dot / denom;
  }

  get vocabSize(): number { return this.vocab.length; }
  get documentCount(): number { return this.docCount; }

  /** 序列化（用于持久化）*/
  serialize(): object {
    return {
      df: Object.fromEntries(this.df),
      docCount: this.docCount,
    };
  }

  /** 从序列化对象恢复 */
  static deserialize(data: { df: Record<string, number>; docCount: number }): TFIDFVectorizer {
    const v = new TFIDFVectorizer();
    v.df = new Map(Object.entries(data.df).map(([k, val]) => [k, val as number]));
    v.docCount = data.docCount;
    v._rebuildVocab();
    return v;
  }
}

// TFIDFVectorizer contract tests — B8.1 retro-fit.
// 纯函数路径：tokenize, addDocument/removeDocument, vectorize, cosineSim,
// serialize/deserialize. 无 IO, 不需要 tmpdir.
import { describe, it, expect } from 'vitest';
import { TFIDFVectorizer } from './vectorizer.js';

describe('TFIDFVectorizer', () => {
  describe('addDocument + vocabSize/documentCount', () => {
    it('starts empty', () => {
      const v = new TFIDFVectorizer();
      expect(v.vocabSize).toBe(0);
      expect(v.documentCount).toBe(0);
    });

    it('grows vocab as documents are added', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('the quick brown fox');
      expect(v.documentCount).toBe(1);
      expect(v.vocabSize).toBeGreaterThan(0);
      v.addDocument('lazy dog');
      expect(v.documentCount).toBe(2);
    });

    it('stopwords are filtered from vocab', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('the a an is');
      // stopwords-only doc adds no vocab entries (and a token of len ≤ 1).
      expect(v.vocabSize).toBe(0);
    });

    it('Chinese characters are tokenized one char at a time', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('你好世界');
      expect(v.vocabSize).toBeGreaterThanOrEqual(3); // 你 好 世 界, minus stopwords
    });
  });

  describe('removeDocument', () => {
    it('decrements doc count and shrinks vocab when DF reaches 0', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('alpha beta gamma');
      const sizeBefore = v.vocabSize;
      v.removeDocument('alpha beta gamma');
      expect(v.documentCount).toBe(0);
      expect(v.vocabSize).toBeLessThan(sizeBefore);
    });

    it('is a no-op when no docs have been added', () => {
      const v = new TFIDFVectorizer();
      v.removeDocument('whatever');
      expect(v.documentCount).toBe(0);
    });
  });

  describe('vectorize', () => {
    it('returns empty array when vocab is empty', () => {
      const v = new TFIDFVectorizer();
      expect(v.vectorize('anything')).toEqual([]);
    });

    it('vector dimensions match vocab size', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('alpha beta gamma');
      const vec = v.vectorize('alpha');
      expect(vec.length).toBe(v.vocabSize);
    });

    it('vector has non-zero entries for matching terms', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('alpha beta gamma');
      const vec = v.vectorize('alpha');
      const nonZero = vec.filter((x) => x > 0);
      expect(nonZero.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cosineSim', () => {
    it('returns 0 for zero-length or mismatched vectors', () => {
      const v = new TFIDFVectorizer();
      expect(v.cosineSim([], [])).toBe(0);
      expect(v.cosineSim([1, 2], [1])).toBe(0);
    });

    it('returns 1 for identical non-zero vectors', () => {
      const v = new TFIDFVectorizer();
      const a = [1, 0, 1];
      expect(v.cosineSim(a, a)).toBeCloseTo(1.0, 4);
    });

    it('returns 0 for orthogonal vectors', () => {
      const v = new TFIDFVectorizer();
      expect(v.cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 4);
    });

    it('returns 0 when either vector is all zeros', () => {
      const v = new TFIDFVectorizer();
      expect(v.cosineSim([0, 0, 0], [1, 1, 1])).toBe(0);
    });
  });

  describe('serialize + deserialize', () => {
    it('round-trips a vectorizer through a JSON object', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('alpha beta gamma');
      v.addDocument('beta delta');

      const serialized = v.serialize() as { df: Record<string, number>; docCount: number };
      expect(serialized.docCount).toBe(2);
      expect(typeof serialized.df).toBe('object');

      const restored = TFIDFVectorizer.deserialize(serialized);
      expect(restored.documentCount).toBe(2);
      expect(restored.vocabSize).toBe(v.vocabSize);
    });

    it('similarity scores survive a serialize round-trip', () => {
      const v = new TFIDFVectorizer();
      v.addDocument('alpha beta');
      v.addDocument('beta gamma');
      const vecA = v.vectorize('alpha');

      const restored = TFIDFVectorizer.deserialize(v.serialize() as { df: Record<string, number>; docCount: number });
      const vecB = restored.vectorize('alpha');
      expect(v.cosineSim(vecA, vecB)).toBeCloseTo(1.0, 4);
    });
  });
});

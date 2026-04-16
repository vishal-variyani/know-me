import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { makeValidateNode } from './validate.node.js';
import type { ExtractionState, PersonExtraction } from '../extraction.types.js';

const mockLogger = { debug: vi.fn(), error: vi.fn() } as unknown as Logger;
const validateNode = makeValidateNode(mockLogger);

function makeState(overrides: Partial<ExtractionState> = {}): ExtractionState {
  return { content: 'test', userId: 'u1', sourceType: 'conversation', correlationId: 'cid', ...overrides };
}

describe('validateNode', () => {
  it('returns undefined validateResult when extractResult is absent', () => {
    expect(validateNode(makeState()).validateResult).toBeUndefined();
  });

  it('strips honorifics and title-cases names', () => {
    const state = makeState({ extractResult: { people: [{ name: 'dr. jake smith', relationship: 'colleague', facts: [] }], topics: [], emotionalTone: 'neutral', keyFacts: [] } });
    const result = validateNode(state);
    expect(result.validateResult?.people[0]?.name).toBe('Jake Smith');
  });

  it('filters pronoun names', () => {
    const state = makeState({ extractResult: { people: [{ name: 'he', relationship: 'friend', facts: [] }], topics: [], emotionalTone: 'neutral', keyFacts: [] } });
    expect(validateNode(state).validateResult).toBeUndefined();
  });

  it('deduplicates within-batch by normalized name', () => {
    const people: PersonExtraction[] = [
      { name: 'Jake', relationship: 'friend', facts: ['likes hiking'] },
      { name: 'jake', relationship: 'friend', facts: ['is a developer'] },
    ];
    const state = makeState({ extractResult: { people, topics: [], emotionalTone: 'neutral', keyFacts: [] } });
    const result = validateNode(state);
    expect(result.validateResult?.people).toHaveLength(1);
    expect(result.validateResult?.people[0]?.facts).toContain('likes hiking');
    expect(result.validateResult?.people[0]?.facts).toContain('is a developer');
  });

  it('maps relationship synonyms', () => {
    const state = makeState({ extractResult: { people: [{ name: 'Sarah', relationship: 'girlfriend', facts: [] }], topics: [], emotionalTone: 'neutral', keyFacts: [] } });
    expect(validateNode(state).validateResult?.people[0]?.relationship).toBe('partner');
  });

  it('returns validateResult when only keyFacts present (no people)', () => {
    const state = makeState({ extractResult: { people: [], topics: [], emotionalTone: 'neutral', keyFacts: ['I love hiking'] } });
    const result = validateNode(state);
    expect(result.validateResult?.keyFacts).toEqual(['I love hiking']);
    expect(result.validateResult?.people).toEqual([]);
  });

  it('returns undefined validateResult when both people and keyFacts are empty after normalization', () => {
    const state = makeState({ extractResult: { people: [{ name: 'he', relationship: 'friend', facts: [] }], topics: [], emotionalTone: 'neutral', keyFacts: [] } });
    expect(validateNode(state).validateResult).toBeUndefined();
  });
});

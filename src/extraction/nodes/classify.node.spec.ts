import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { makeClassifyNode } from './classify.node.js';
import type { ExtractionState } from '../extraction.types.js';

const mockLogger = { debug: vi.fn(), error: vi.fn() } as unknown as Logger;
const classifyNode = makeClassifyNode(mockLogger);

function makeState(content: string): ExtractionState {
  return { content, userId: 'u1', sourceType: 'conversation', correlationId: 'test-cid' };
}

describe('classifyNode', () => {
  it.each([
    ['ok', false],
    ['thanks', false],
    ['sure', false],
    ['yes', false],
    ['no', false],
    ['hi', false],
    ['hello', false],
    ['bye', false],
  ])('returns shouldExtract=false for trivial "%s"', (content, expected) => {
    const result = classifyNode(makeState(content));
    expect(result.classifyResult?.shouldExtract).toBe(expected);
  });

  it('returns true when content contains a noun phrase', () => {
    expect(
      classifyNode(makeState('I love spicy food')).classifyResult?.shouldExtract,
    ).toBe(true);
  });

  it('returns true for message with proper noun', () => {
    expect(
      classifyNode(makeState('I had lunch with Sarah')).classifyResult?.shouldExtract,
    ).toBe(true);
  });

  it('returns true for message mentioning a person by name', () => {
    expect(
      classifyNode(makeState('My friend Jake is a developer')).classifyResult
        ?.shouldExtract,
    ).toBe(true);
  });

  it('returns false for trivial multi-word "ok thanks"', () => {
    expect(
      classifyNode(makeState('ok thanks')).classifyResult?.shouldExtract,
    ).toBe(false);
  });
});

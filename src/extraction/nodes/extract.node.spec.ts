import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ChatOpenAI } from '@langchain/openai';
import type { ExtractionState } from '../extraction.types.js';

// We capture the invoke mock so individual tests can configure its behaviour.
// The chain is built inside makeExtractNode via prompt.pipe(llm.withStructuredOutput(...)).
// Both the prompt mock and the llm mock must return objects that forward to mockInvoke.
const mockInvoke = vi.fn();

vi.mock('@langchain/core/prompts', () => ({
  ChatPromptTemplate: {
    fromMessages: vi.fn().mockReturnValue({
      pipe: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    }),
  },
}));

// Import AFTER mocks are established.
const { makeExtractNode } = await import('./extract.node.js');

const mockLogger = {
  debug: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

// Build a mock llm whose withStructuredOutput returns a runnable with our mockInvoke.
// This is passed directly to makeExtractNode — no need to instantiate ChatOpenAI.
const mockLlm = {
  withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
} as unknown as ChatOpenAI;

function makeState(content = 'I had lunch with Sarah today'): ExtractionState {
  return {
    content,
    userId: 'u1',
    sourceType: 'conversation',
    correlationId: 'test-cid',
  };
}

const VALID_RESULT = {
  people: [{ name: 'Sarah', relationship: 'friend', facts: ['had lunch together'] }],
  topics: ['social activities'],
  emotionalTone: 'positive',
  keyFacts: ['I enjoy having lunch with friends'],
};

const EMPTY_RESULT = {
  people: [],
  topics: [],
  emotionalTone: 'neutral',
  keyFacts: [],
};

describe('extractNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns extractResult on successful LLM call', async () => {
    mockInvoke.mockResolvedValueOnce(VALID_RESULT);

    const extractNode = makeExtractNode(mockLlm, mockLogger);
    const result = await extractNode(makeState());

    expect(result.extractResult).toEqual(VALID_RESULT);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('retries once on first failure and returns result on retry success', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(VALID_RESULT);

    const extractNode = makeExtractNode(mockLlm, mockLogger);
    const result = await extractNode(makeState());

    expect(result.extractResult).toEqual(VALID_RESULT);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('returns empty result after double failure — does not throw', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout again'));

    const extractNode = makeExtractNode(mockLlm, mockLogger);
    const result = await extractNode(makeState());

    expect(result.extractResult).toEqual(EMPTY_RESULT);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('logs an error when retry fails', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'));

    const extractNode = makeExtractNode(mockLlm, mockLogger);
    await extractNode(makeState());

    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('logs debug on success with people and keyFacts count', async () => {
    mockInvoke.mockResolvedValueOnce(VALID_RESULT);

    const extractNode = makeExtractNode(mockLlm, mockLogger);
    await extractNode(makeState());

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('people=1'),
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('keyFacts=1'),
    );
  });
});

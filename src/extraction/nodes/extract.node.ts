import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Logger } from '@nestjs/common';
import type { ExtractionState } from '../extraction.types.js';

// ---------------------------------------------------------------------------
// Zod schema (D-05) — defines the structured output the LLM must return.
// withStructuredOutput(ExtractOutputSchema) enforces this at runtime:
// any malformed response throws and triggers the D-06 retry-then-absorb path.
// ---------------------------------------------------------------------------

const PersonExtractionSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  facts: z.array(z.string()),
});

const ExtractOutputSchema = z.object({
  people: z.array(PersonExtractionSchema),
  topics: z.array(z.string()),
  emotionalTone: z.enum([
    'neutral',
    'positive',
    'negative',
    'anxious',
    'excited',
    'sad',
    'frustrated',
  ]),
  keyFacts: z.array(z.string()),
});

type ExtractOutput = z.infer<typeof ExtractOutputSchema>;

// ---------------------------------------------------------------------------
// System prompt — instructs GPT-4o-mini on what to extract and how to format it.
// User content is injected into the separate ['human', '{content}'] message
// (T-04-02-02: LangChain message roles provide structural separation from the
// system prompt, preventing prompt injection from altering extraction behaviour).
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM_PROMPT = `You are an information extraction assistant analyzing a user's message for persistent memory.

Extract the following:
- people: any named individuals mentioned (name, their relationship to the user, and notable facts about them)
- topics: broad subject areas discussed (e.g., "food preferences", "career", "travel")
- emotionalTone: the user's emotional state in this message
- keyFacts: statements about the USER THEMSELVES that are worth remembering (preferences, beliefs, experiences, goals)

Return ONLY valid JSON matching the schema. If nothing is worth extracting, return empty arrays.
For people, only include actual named individuals (not pronouns or generic references like "a friend").
For keyFacts, write each fact as a complete sentence from the user's perspective.`;

// ---------------------------------------------------------------------------
// Empty result — returned on double failure (D-06: absorb, never throw).
// ---------------------------------------------------------------------------

const EMPTY_RESULT: ExtractOutput = {
  people: [],
  topics: [],
  emotionalTone: 'neutral',
  keyFacts: [],
};

// ---------------------------------------------------------------------------
// makeExtractNode — factory returning the async LangGraph node function.
//
// D-04: Single GPT-4o-mini call per message using ChatPromptTemplate + Zod.
// D-06: Retry once on failure; absorb on second failure (return EMPTY_RESULT).
// T-04-02-01: Zod validation on LLM output prevents malformed data reaching Validate.
// T-04-02-04: Errors logged with correlationId; no user content in error strings.
// ---------------------------------------------------------------------------

export function makeExtractNode(llm: ChatOpenAI, logger: Logger) {
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', EXTRACT_SYSTEM_PROMPT],
    ['human', '{content}'],
  ]);
  const chain = prompt.pipe(llm.withStructuredOutput(ExtractOutputSchema));

  return async function extractNode(
    state: ExtractionState,
  ): Promise<Partial<ExtractionState>> {
    const { content, correlationId } = state;

    // D-06: Try once, retry once on failure, absorb on second failure.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await chain.invoke({ content });
        logger.debug(
          `[${correlationId}] extractNode people=${result.people.length} keyFacts=${result.keyFacts.length}`,
        );
        return { extractResult: result };
      } catch (err: unknown) {
        logger.error(
          `[${correlationId}] extractNode attempt=${attempt} failed: ${String(err)}`,
        );
        if (attempt === 2) {
          return { extractResult: EMPTY_RESULT };
        }
      }
    }

    // TypeScript exhaustiveness — loop above always returns or falls through here.
    return { extractResult: EMPTY_RESULT };
  };
}

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Logger } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsString,
  type ValidationError,
  ValidateNested,
  validateSync,
} from 'class-validator';
import type { ExtractionState } from '../extraction.types.js';

const EMOTIONAL_TONE_VALUES = [
  'neutral',
  'positive',
  'negative',
  'anxious',
  'excited',
  'sad',
  'frustrated',
] as const;
type EmotionalTone = (typeof EMOTIONAL_TONE_VALUES)[number];

const EMOTIONAL_TONE_SYNONYMS: Record<string, EmotionalTone> = {
  happy: 'positive',
  joyful: 'positive',
  optimistic: 'positive',
  relieved: 'positive',
  grateful: 'positive',
  excited: 'excited',
  calm: 'neutral',
  okay: 'neutral',
  ok: 'neutral',
  mixed: 'neutral',
  uncertain: 'anxious',
  worried: 'anxious',
  stressed: 'anxious',
  nervous: 'anxious',
  angry: 'frustrated',
  annoyed: 'frustrated',
  upset: 'negative',
  disappointed: 'negative',
  unhappy: 'negative',
  down: 'sad',
  depressed: 'sad',
};

class PersonExtractionDto {
  @IsString()
  name!: string;

  @IsString()
  relationship!: string;

  @IsArray()
  @IsString({ each: true })
  facts!: string[];
}

class ExtractOutputDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonExtractionDto)
  people!: PersonExtractionDto[];

  @IsArray()
  @IsString({ each: true })
  topics!: string[];

  @IsString()
  @IsIn(EMOTIONAL_TONE_VALUES)
  emotionalTone!: EmotionalTone;

  @IsArray()
  @IsString({ each: true })
  keyFacts!: string[];
}

type ExtractOutput = {
  people: { name: string; relationship: string; facts: string[] }[];
  topics: string[];
  emotionalTone: EmotionalTone;
  keyFacts: string[];
};

const EXTRACT_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          relationship: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'relationship', 'facts'],
        additionalProperties: false,
      },
    },
    topics: {
      type: 'array',
      items: { type: 'string' },
    },
    emotionalTone: {
      type: 'string',
    },
    keyFacts: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['people', 'topics', 'emotionalTone', 'keyFacts'],
  additionalProperties: false,
} as const;

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
  const chain = prompt.pipe(llm.withStructuredOutput(EXTRACT_OUTPUT_JSON_SCHEMA));

  return async function extractNode(
    state: ExtractionState,
  ): Promise<Partial<ExtractionState>> {
    const { content, correlationId } = state;

    // D-06: Try once, retry once on failure, absorb on second failure.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = (await chain.invoke({ content })) as ExtractOutput;
        validateExtractOutput(result);
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

function validateExtractOutput(result: ExtractOutput): void {
  result.emotionalTone = normalizeEmotionalTone(result.emotionalTone);
  const dto = plainToInstance(ExtractOutputDto, result);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const formatted = formatValidationErrors(errors).join('; ');
    throw new Error(`Invalid extract output payload: ${formatted}`);
  }
}

function normalizeEmotionalTone(raw: string): EmotionalTone {
  const normalized = raw.toLowerCase().trim();
  if ((EMOTIONAL_TONE_VALUES as readonly string[]).includes(normalized)) {
    return normalized as EmotionalTone;
  }
  return EMOTIONAL_TONE_SYNONYMS[normalized] ?? 'neutral';
}

function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): string[] {
  const output: string[] = [];
  for (const err of errors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints) {
      for (const message of Object.values(err.constraints)) {
        output.push(`${path}: ${message}`);
      }
    }
    if (err.children && err.children.length > 0) {
      output.push(...formatValidationErrors(err.children, path));
    }
  }
  return output;
}

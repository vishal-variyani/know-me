import { Logger } from '@nestjs/common';
import nlp from 'compromise';
import type { ExtractionState } from '../extraction.types.js';

// D-01: Trivial message patterns — must match entire trimmed content (case-insensitive).
// Single-word/short greetings and acknowledgements that carry no extractable information.
// The regex anchors to the full string — only exact phrase matches are filtered.
const TRIVIAL_PATTERN =
  /^(ok|okay|thanks|sure|yes|no|hi|hello|bye|yep|nope|cool|great|got it|sounds good)\.?!?$/i;

/**
 * Determines whether the content contains at least one proper noun.
 */
function hasProperNounInContent(content: string): boolean {
  return nlp(content).match('#ProperNoun').found;
}

/**
 * Factory that returns the synchronous classifyNode LangGraph node function.
 *
 * Implements D-01, D-02, D-03: rule-based classification with zero LLM cost.
 * Returns { classifyResult: { shouldExtract } } — the conditional edge in the graph
 * routes to Extract when shouldExtract=true, otherwise to END.
 */
export function makeClassifyNode(logger: Logger) {
  return function classifyNode(
    state: ExtractionState,
  ): Partial<ExtractionState> {
    const { content, correlationId } = state;
    const trimmed = content.trim();

    const isTrivial = TRIVIAL_PATTERN.test(trimmed);
    if (isTrivial) {
      logger.debug(
        `[${correlationId}] classifyNode shouldExtract=false isTrivial=true hasProperNoun=skipped contentLen=${trimmed.length}`,
      );

      return { classifyResult: { shouldExtract: false } };
    }

    const hasProperNoun = hasProperNounInContent(trimmed);
    const shouldExtract = hasProperNoun;

    logger.debug(
      `[${correlationId}] classifyNode shouldExtract=${shouldExtract} isTrivial=${isTrivial} hasProperNoun=${hasProperNoun} contentLen=${trimmed.length}`,
    );

    return { classifyResult: { shouldExtract } };
  };
}

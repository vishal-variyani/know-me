import { Logger } from '@nestjs/common';
import type { ExtractionState } from '../extraction.types.js';

// D-01: Trivial message patterns — must match entire trimmed content (case-insensitive).
// Single-word/short greetings and acknowledgements that carry no extractable information.
// The regex anchors to the full string — only exact phrase matches are filtered.
const TRIVIAL_PATTERN =
  /^(ok|okay|thanks|sure|yes|no|hi|hello|bye|yep|nope|cool|great|got it|sounds good)\.?!?$/i;

/**
 * Determines whether the content contains at least one proper noun.
 *
 * Strategy (D-01):
 * 1. Skip the very first word to avoid false positives from sentence-initial capitalisation.
 * 2. Check words at index >= 1 for the pattern /^[A-Z][a-z]{1,}$/ after stripping punctuation.
 * 3. Also accept the first word as a proper noun if the sentence is >= 3 words long
 *    (e.g. "Jake is my friend" — "Jake" is clearly a proper noun, not sentence-initial cap).
 */
function hasProperNounInContent(content: string): boolean {
  const words = content.trim().split(/\s+/);

  // Check words from index 1 onwards — these are unambiguously proper nouns if capitalised.
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z]/g, '');
    if (/^[A-Z][a-z]{1,}$/.test(word)) return true;
  }

  // Also accept the first word when the sentence is long enough that sentence-initial
  // capitalisation is unlikely to be the sole reason for the capital letter.
  if (words.length >= 3 && words[0] && /^[A-Z][a-z]{1,}$/.test(words[0])) {
    return true;
  }

  return false;
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
    const hasProperNoun = hasProperNounInContent(trimmed);

    const shouldExtract = !isTrivial && hasProperNoun;

    logger.debug(
      `[${correlationId}] classifyNode shouldExtract=${shouldExtract} isTrivial=${isTrivial} hasProperNoun=${hasProperNoun} contentLen=${trimmed.length}`,
    );

    return { classifyResult: { shouldExtract } };
  };
}

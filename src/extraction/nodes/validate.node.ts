import { Logger } from '@nestjs/common';
import type { ExtractionState, PersonExtraction } from '../extraction.types.js';

// D-10: Generic references and pronouns to filter — case-insensitive exact name match
const FILTERED_NAMES = new Set([
  'he', 'she', 'they', 'them', 'him', 'her',
  'someone', 'somebody', 'anyone', 'anybody',
  'the user', 'a person', 'a friend', 'a colleague',
  'my friend', 'my colleague', 'my partner', 'my boss',
]);

// D-09: Honorifics to strip before title-casing
const HONORIFIC_PATTERN = /^(mr\.|mrs\.|ms\.|dr\.|prof\.|rev\.)\s*/i;

// D-12: Relationship synonym → canonical form
const RELATIONSHIP_SYNONYMS: Record<string, string> = {
  girlfriend: 'partner',
  boyfriend: 'partner',
  wife: 'spouse',
  husband: 'spouse',
  'significant other': 'partner',
  fiancee: 'partner',
  fiance: 'partner',
  fiancée: 'partner',
  fiancé: 'partner',
  'best friend': 'close friend',
  bestfriend: 'close friend',
  'work friend': 'colleague',
  coworker: 'colleague',
  'co-worker': 'colleague',
};

function normalizeName(raw: string): string {
  // D-09: Trim, strip honorifics, title-case each word
  const stripped = raw.trim().replace(HONORIFIC_PATTERN, '');
  return stripped
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function normalizeRelationship(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return RELATIONSHIP_SYNONYMS[lower] ?? lower;
}

function isFiltered(name: string): boolean {
  return FILTERED_NAMES.has(name.toLowerCase().trim());
}

function normalizePeople(people: PersonExtraction[]): PersonExtraction[] {
  const byName = new Map<string, PersonExtraction>();

  for (const person of people) {
    const normalized = normalizeName(person.name);

    // D-10: Drop pronouns and generic references
    if (isFiltered(normalized) || isFiltered(person.name)) continue;

    // D-11: Within-batch dedup — merge facts if name already seen
    const existing = byName.get(normalized);
    if (existing) {
      // Merge: deduplicate facts by string equality
      const mergedFacts = Array.from(new Set([...existing.facts, ...person.facts]));
      byName.set(normalized, { ...existing, facts: mergedFacts });
    } else {
      byName.set(normalized, {
        name: normalized,
        relationship: normalizeRelationship(person.relationship),
        facts: person.facts,
      });
    }
  }

  return Array.from(byName.values());
}

export function makeValidateNode(logger: Logger) {
  return function validateNode(
    state: ExtractionState,
  ): Partial<ExtractionState> {
    const { extractResult, correlationId } = state;

    if (!extractResult) {
      logger.debug(`[${correlationId}] validateNode: no extractResult — skipping`);
      return { validateResult: undefined };
    }

    const normalizedPeople = normalizePeople(extractResult.people);
    const keyFacts = extractResult.keyFacts.filter((f) => f.trim().length > 0);

    const valid = normalizedPeople.length > 0 || keyFacts.length > 0;

    logger.debug(
      `[${correlationId}] validateNode valid=${valid} people=${normalizedPeople.length} keyFacts=${keyFacts.length}`,
    );

    if (!valid) {
      // D-13: Conditional edge → END if nothing to store
      return { validateResult: undefined };
    }

    return { validateResult: { people: normalizedPeople, keyFacts } };
  };
}

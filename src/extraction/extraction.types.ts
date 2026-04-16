// Interface-only — no runtime imports. Analog: src/memory/memory.types.ts

export interface PersonExtraction {
  name: string;
  relationship: string;
  facts: string[];
}

export interface ExtractionState {
  content: string;
  userId: string;
  sourceType: 'conversation' | 'document';
  correlationId: string;
  classifyResult?: { shouldExtract: boolean };
  extractResult?: {
    people: PersonExtraction[];
    topics: string[];
    emotionalTone: string;
    keyFacts: string[];
  };
  validateResult?: { people: PersonExtraction[]; keyFacts: string[] };
  storeResult?: { persisted: number };
}

export interface ExtractionJobPayload {
  content: string;
  userId: string;
  sourceType: 'conversation' | 'document';
}

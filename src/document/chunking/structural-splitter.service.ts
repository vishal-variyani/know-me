import { Injectable } from '@nestjs/common';
import { DocumentFormat } from '../interfaces/document-format.enum.js';

export interface RawSegment {
  text: string;
  dateHint: string | null;
  entryIndex: number;
}

@Injectable()
export class StructuralSplitterService {
  detectFormat(text: string, filename?: string): DocumentFormat {
    const name = filename?.toLowerCase() ?? '';
    if (name.includes('journal') || name.includes('diary')) return DocumentFormat.JOURNAL;
    if (name.includes('chat') || name.includes('message')) return DocumentFormat.CHAT_EXPORT;
    if (/\n---\n/.test(text)) return DocumentFormat.JOURNAL;
    if (/\n\n+/.test(text)) return DocumentFormat.NOTES;
    return DocumentFormat.PLAIN;
  }

  split(text: string, format: DocumentFormat): RawSegment[] {
    switch (format) {
      case DocumentFormat.JOURNAL:
        return text
          .split(/\n---\n/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((entry, i) => ({ text: entry, dateHint: this.parseDate(entry.split('\n')[0]), entryIndex: i }));
      case DocumentFormat.NOTES:
      case DocumentFormat.CHAT_EXPORT:
      case DocumentFormat.PLAIN:
      default:
        return text
          .split(/\n\n+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((entry, i) => ({ text: entry, dateHint: null, entryIndex: i }));
    }
  }

  private parseDate(line: string): string | null {
    const date = new Date(line.trim());
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0] ?? null;
  }
}

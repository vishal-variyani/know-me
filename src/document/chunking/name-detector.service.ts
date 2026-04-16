import { Injectable } from '@nestjs/common';
import nlp from 'compromise';

@Injectable()
export class NameDetectorService {
  private readonly excluded = new Set([
    'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'he', 'she', 'they', 'them',
  ]);

  detectNames(text: string, knownEntities: string[] = []): string[] {
    const detected = new Set<string>();
    const names = nlp(text).people().out('array') as string[];
    for (const name of names) {
      const normalized = this.normalize(name);
      if (normalized && !this.excluded.has(normalized.toLowerCase())) {
        detected.add(normalized);
      }
    }
    for (const known of knownEntities) {
      const regex = new RegExp(`\\b${this.escapeRegex(known)}\\b`, 'i');
      if (regex.test(text)) detected.add(known);
    }
    return Array.from(detected);
  }

  private normalize(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

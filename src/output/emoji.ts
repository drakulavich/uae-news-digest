import { matchesTerm } from '../pipeline/terms';
import type { EmojiRule } from '../config/schema';

/** First rule whose term appears in the title wins; no rules or no match → "•". */
export function emojiFor(title: string, rules: readonly EmojiRule[] | undefined): string {
  const rule = rules?.find((r) => r.terms.some((t) => matchesTerm(title, t)));
  return rule?.emoji ?? '•';
}

/** Whole hours between publication and `now`, rounded to nearest. */
export function hoursAgo(publishedAt: Date, now: Date): number {
  return Math.round((now.getTime() - publishedAt.getTime()) / 3_600_000);
}

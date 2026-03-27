/**
 * Input sanitization utilities for tRPC routes.
 * Prevents injection via Supabase PostgREST filter interpolation.
 */

/**
 * Sanitize a search string before interpolating into Supabase
 * .ilike() / .or() filter expressions.
 *
 * Strips characters that could escape PostgREST filter syntax:
 *   ,  separates filter clauses
 *   .  separates column.operator.value
 *   ( )  grouping / logical expressions
 *   \  escape character
 *   %  wildcard (we add our own)
 *   ;  statement separator
 *   '  "  string delimiters
 */
export function sanitizeSearchInput(input: string, maxLength = 200): string {
  return input
    .slice(0, maxLength)
    .replace(/[,.()\\\[\]%;'"]/g, '')
    .trim();
}

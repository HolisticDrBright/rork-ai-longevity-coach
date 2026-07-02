/**
 * Helpers for safely building PostgREST filter strings.
 */

/**
 * Sanitize a user-supplied search term before interpolating it into a
 * PostgREST `.or(...)` filter string.
 *
 * PostgREST parses `,` as an OR-branch separator and `(`/`)` as grouping,
 * so a raw search term like `x,clinician_id.eq.someone-else` would inject
 * additional filter branches. Backslashes are stripped as well to avoid
 * escape-sequence tricks in quoted literals.
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()\\]/g, "").trim();
}

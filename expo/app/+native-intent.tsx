export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  try {
    // Pass deep links / notification taps through unchanged.
    return path;
  } catch {
    return '/';
  }
}

// Old deep-link paths (pre tab-consolidation) rewritten to the new grouped
// routes so existing links and notification taps keep working.
const LEGACY_PATH_PREFIXES: [string, string][] = [
  ['/(tabs)/(nutrition)', '/(tabs)/(log)/(nutrition)'],
  ['/(tabs)/(wearables)', '/(tabs)/(health)/(wearables)'],
  ['/(tabs)/insights', '/(tabs)/(health)/insights'],
  ['/(tabs)/analysis', '/(tabs)/(health)/analysis'],
  ['/(tabs)/labs', '/(tabs)/(health)/labs'],
  ['/(tabs)/tracking', '/(tabs)/(log)/tracking'],
  ['/hormones', '/(tabs)/(log)/tracking'],
];

export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  try {
    for (const [oldPrefix, newPrefix] of LEGACY_PATH_PREFIXES) {
      if (path === oldPrefix || path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}?`)) {
        return `${newPrefix}${path.slice(oldPrefix.length)}`;
      }
    }
    // Pass other deep links / notification taps through unchanged.
    return path;
  } catch {
    return '/';
  }
}

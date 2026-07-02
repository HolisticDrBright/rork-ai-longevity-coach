import { describe, test, expect } from 'vitest';
import { findAffiliateLink, DEFAULT_SUPPLEMENT_LINK } from '@/constants/affiliateLinks';

describe('findAffiliateLink (bug 12: word boundaries + longest keyword wins)', () => {
  test("'Phosphatidylcholine (BodyBio PC)' resolves to BodyBio, not FullScript's 'choline'", () => {
    const link = findAffiliateLink('Phosphatidylcholine (BodyBio PC)');
    expect(link.name).toBe('BodyBio');
  });

  test("'choline' inside 'phosphatidylcholine' does not match on a word boundary", () => {
    // BodyBio's own 'phosphatidylcholine' keyword should win even without
    // the brand name present.
    const link = findAffiliateLink('Phosphatidylcholine 900mg');
    expect(link.name).toBe('BodyBio');
  });

  test("'Environmental Detox Support' does not match 'iron' inside 'environmental'", () => {
    const link = findAffiliateLink('Environmental Detox Support');
    expect(link.name).toBe(DEFAULT_SUPPLEMENT_LINK.name);
    expect(link.url).toBe(DEFAULT_SUPPLEMENT_LINK.url);
  });

  test('matching is case-insensitive', () => {
    expect(findAffiliateLink('MAGNESIUM GLYCINATE').name).toBe('FullScript');
    expect(findAffiliateLink('CellCore Carboxy').name).toBe('CellCore');
  });

  test('longest keyword wins across entries', () => {
    // 'castor oil' (Queen of Thrones) must beat the generic single-word
    // matches even though FullScript appears first in the list.
    expect(findAffiliateLink('Castor Oil Pack Kit').name).toBe('Queen of Thrones');
  });

  test('unknown products fall back to the default FullScript link', () => {
    expect(findAffiliateLink('Completely Unknown Product XYZ').name).toBe(DEFAULT_SUPPLEMENT_LINK.name);
  });
});

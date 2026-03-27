import { describe, test, expect } from 'vitest';
import { sanitizeSearchInput } from '../../backend/trpc/sanitize';

describe('sanitizeSearchInput', () => {
  test('passes through normal search text', () => {
    expect(sanitizeSearchInput('John Smith')).toBe('John Smith');
  });

  test('strips commas that could separate filter clauses', () => {
    expect(sanitizeSearchInput('test,or.1.eq.true')).toBe('testor1eqtrue');
  });

  test('strips dots that could break PostgREST syntax', () => {
    expect(sanitizeSearchInput('foo.bar.baz')).toBe('foobarbaz');
  });

  test('strips parentheses used in filter grouping', () => {
    expect(sanitizeSearchInput('test(or)and')).toBe('testorand');
  });

  test('strips backslashes', () => {
    expect(sanitizeSearchInput('test\\injection')).toBe('testinjection');
  });

  test('strips percent signs (SQL wildcards)', () => {
    expect(sanitizeSearchInput('100% safe')).toBe('100 safe');
  });

  test('strips single and double quotes', () => {
    expect(sanitizeSearchInput("O'Brien")).toBe('OBrien');
    expect(sanitizeSearchInput('test"value')).toBe('testvalue');
  });

  test('strips semicolons', () => {
    expect(sanitizeSearchInput('test;DROP TABLE')).toBe('testDROP TABLE');
  });

  test('truncates to max length', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeSearchInput(long).length).toBe(200);
  });

  test('custom max length', () => {
    const long = 'a'.repeat(50);
    expect(sanitizeSearchInput(long, 10).length).toBe(10);
  });

  test('trims whitespace', () => {
    expect(sanitizeSearchInput('  hello  ')).toBe('hello');
  });

  test('handles empty string', () => {
    expect(sanitizeSearchInput('')).toBe('');
  });

  test('handles string with only dangerous chars', () => {
    expect(sanitizeSearchInput('.,()\\[]%;\'\"')).toBe('');
  });
});

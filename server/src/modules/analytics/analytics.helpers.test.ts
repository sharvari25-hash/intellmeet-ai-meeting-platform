import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInclusive,
  escapeCsvCell,
  isFormulaLike,
  isKnownTimeZone,
  rangeForWeeks,
  startOfWeek,
  toCsv,
  todayIn,
  weekStarts,
} from '@intellmeet/shared';
import type { Redis } from 'ioredis';
import { setRedisClient } from '../../config/redis.js';
import { cachedAnalytics, invalidateTeamAnalytics } from './analytics.cache.js';
import { zonedDayStart } from './analytics.scope.js';

describe('CSV escaping', () => {
  it.each([
    ['=1+1', `"'=1+1"`],
    ['+1', `"'+1"`],
    ['-1+2', `"'-1+2"`],
    ['@SUM(A1:A9)', `"'@SUM(A1:A9)"`],
    ['\t=1+1', `"'\t=1+1"`],
    ['\r=1+1', `"'\r=1+1"`],
    ['  =1+1', `"'  =1+1"`],
    ['\u00A0=1+1', `"'\u00A0=1+1"`],
    // Full-width forms, which some spreadsheets normalise before parsing.
    ['\uFF1D1+1', `"'\uFF1D1+1"`],
    ['\uFF20cmd', `"'\uFF20cmd"`],
  ])('defuses %j', (value, expected) => {
    expect(isFormulaLike(value)).toBe(true);
    expect(escapeCsvCell(value)).toBe(expected);
  });

  it.each([
    ['Ada Lovelace', '"Ada Lovelace"'],
    ['a=b', '"a=b"'],
    ['2026-08-03', '"2026-08-03"'],
    ['', '""'],
  ])('leaves %j alone apart from quoting', (value, expected) => {
    expect(isFormulaLike(value)).toBe(false);
    expect(escapeCsvCell(value)).toBe(expected);
  });

  it('keeps commas, quotes and line breaks inside their cell', () => {
    expect(escapeCsvCell('He said "hi", then\nleft')).toBe('"He said ""hi"", then\nleft"');
  });

  it('writes numbers as numbers, negative ones included', () => {
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(-3)).toBe('-3');
    expect(escapeCsvCell(0.5)).toBe('0.5');
    expect(escapeCsvCell(Number.NaN)).toBe('');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(true)).toBe('true');
  });

  it('builds a document with a byte order mark and CRLF line ends', () => {
    expect(
      toCsv([
        ['Name', 'Tasks'],
        ['Zoë', 3],
      ]),
    ).toBe('\uFEFF"Name","Tasks"\r\n"Zoë",3\r\n');
  });
});

describe('calendar helpers', () => {
  it('finds the Monday of a week', () => {
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21'); // Monday
    expect(startOfWeek('2026-09-24')).toBe('2026-09-21'); // Thursday
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21'); // Sunday
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28'); // across a year
  });

  it('lists the weeks a range touches', () => {
    expect(weekStarts('2026-08-06', '2026-08-17')).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
    ]);
    expect(weekStarts('2026-08-03', '2026-08-03')).toEqual(['2026-08-03']);
  });

  it('counts days inclusively and adds them across months and leap days', () => {
    expect(daysInclusive('2026-08-03', '2026-08-03')).toBe(1);
    expect(daysInclusive('2026-01-01', '2026-12-31')).toBe(365);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('builds the preset ranges from whole weeks', () => {
    expect(rangeForWeeks(8, '2026-09-24')).toEqual({ from: '2026-08-03', to: '2026-09-24' });
    expect(rangeForWeeks(1, '2026-09-21')).toEqual({ from: '2026-09-21', to: '2026-09-21' });
  });

  it('knows what day it is in a time zone', () => {
    const lateEvening = new Date('2026-09-23T20:00:00Z');
    expect(todayIn('UTC', lateEvening)).toBe('2026-09-23');
    expect(todayIn('Asia/Kolkata', lateEvening)).toBe('2026-09-24');
    expect(todayIn('America/Los_Angeles', new Date('2026-09-24T03:00:00Z'))).toBe('2026-09-23');
  });

  it('accepts IANA zone names only', () => {
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isKnownTimeZone('+05:30')).toBe(false);
    expect(isKnownTimeZone('')).toBe(false);
    expect(isKnownTimeZone('Asia/Kolkata; drop')).toBe(false);
  });
});

describe('zonedDayStart', () => {
  it.each([
    ['2026-09-24', 'UTC', '2026-09-24T00:00:00.000Z'],
    ['2026-09-24', 'Asia/Kolkata', '2026-09-23T18:30:00.000Z'],
    ['2026-09-24', 'America/New_York', '2026-09-24T04:00:00.000Z'], // EDT
    ['2026-12-24', 'America/New_York', '2026-12-24T05:00:00.000Z'], // EST
    // The days clocks change, on both sides of the Atlantic and the equator.
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z'],
    ['2026-03-29', 'Europe/London', '2026-03-29T00:00:00.000Z'],
    ['2026-10-25', 'Europe/London', '2026-10-24T23:00:00.000Z'],
    ['2026-04-05', 'Australia/Sydney', '2026-04-04T13:00:00.000Z'],
    ['2026-09-24', 'Pacific/Kiritimati', '2026-09-23T10:00:00.000Z'], // UTC+14
  ])('%s starts at local midnight in %s', (day, tz, expected) => {
    expect(zonedDayStart(day, tz).toISOString()).toBe(expected);
  });
});

// The suite's global `afterEach` puts the in-memory Redis back after each test.
describe('the analytics cache without Redis', () => {
  it('still answers, recomputing every time, and invalidation never throws', async () => {
    const failing = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      incr: () => Promise.reject(new Error('down')),
      expire: () => Promise.reject(new Error('down')),
    };
    setRedisClient(failing as unknown as Redis);

    let computed = 0;
    const load = async () => ({ value: (computed += 1) });
    expect(await cachedAnalytics('test', 'team', ['a'], load)).toEqual({ value: 1 });
    expect(await cachedAnalytics('test', 'team', ['a'], load)).toEqual({ value: 2 });
    await expect(invalidateTeamAnalytics(['team'])).resolves.toBeUndefined();
  });

  it('shares an answer until the team is invalidated', async () => {
    let computed = 0;
    const load = async () => ({ value: (computed += 1) });
    expect(await cachedAnalytics('test', 'team', ['a'], load)).toEqual({ value: 1 });
    expect(await cachedAnalytics('test', 'team', ['a'], load)).toEqual({ value: 1 });
    // Another team, or another range, is its own entry.
    expect(await cachedAnalytics('test', 'other', ['a'], load)).toEqual({ value: 2 });
    expect(await cachedAnalytics('test', 'team', ['b'], load)).toEqual({ value: 3 });

    await invalidateTeamAnalytics(['team', null, undefined, 'team']);
    expect(await cachedAnalytics('test', 'team', ['a'], load)).toEqual({ value: 4 });
    expect(await cachedAnalytics('test', 'other', ['a'], load)).toEqual({ value: 2 });
  });
});

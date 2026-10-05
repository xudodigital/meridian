import { describe, expect, it } from 'vitest';
import { actor, cleanName, emailError, nameError, passwordError, sessionOf } from './session';
import { meFor } from './testing';

describe('the person\'s name', () => {
  it('is required, trimmed and at most 60 characters', () => {
    expect(nameError('')).toBe('Enter your name, for example Dewi Lestari.');
    expect(nameError('   \n ')).toBe('Enter your name, for example Dewi Lestari.');
    expect(nameError('x'.repeat(61))).toBe('Enter a name of at most 60 characters.');
    expect(nameError('  ' + 'x'.repeat(60) + '  ')).toBe('');
    expect(cleanName('  Dewi \t  Lestari ')).toBe('Dewi Lestari');
  });

  it('is what the signed-in person is recorded under, "Unknown" when nobody is', () => {
    expect(actor({ session: sessionOf(meFor('editor', 'Dewi')) })).toBe('Dewi');
    expect(actor({ session: null })).toBe('Unknown');
  });
});

describe('the sign-in forms', () => {
  it('check passwords as the server does: 12 to 200 characters, typed twice the same', () => {
    expect(passwordError('short')).toBe('Use a password of at least 12 characters.');
    expect(passwordError('a'.repeat(201))).toBe('Use a password of at most 200 characters.');
    expect(passwordError('a'.repeat(12))).toBe('');
    expect(passwordError('a'.repeat(12), 'b'.repeat(12))).toBe('The two passwords are not the same.');
    expect(emailError('dewi@example.com')).toBe('');
    expect(emailError('dewi')).toBe('Enter a valid email address.');
  });
});

describe('the session', () => {
  it('comes from the server\'s answer, with the reviewer\'s site and whether 2-step setup is required', () => {
    expect(sessionOf(meFor('reviewer', 'Linh', 'linh@example.com', { twofa: true, mustEnroll: false }))).toEqual({
      id: '3', email: 'linh@example.com', role: 'reviewer', name: 'Linh', site: 'a', twofa: true, enroll: false,
    });
    expect(sessionOf(meFor('viewer', 'Vic', 'v@example.com', { mustEnroll: true })).enroll).toBe(true);
  });
});

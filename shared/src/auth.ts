import { z } from 'zod';
import { emailSchema } from './common.js';
import { publicUserSchema } from './user.js';

/**
 * Password policy, enforced identically on the client (react-hook-form) and
 * the server, because both import this schema.
 *
 * Length does more for entropy than character-class rules do, hence a 12-char
 * floor rather than the more common 8 plus a longer list of required classes.
 * The 128 ceiling is not cosmetic: bcrypt silently truncates at 72 bytes, and
 * an unbounded password is a cheap way to make the server burn CPU.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not `passwordSchema`: an existing account may predate a
  // policy change, and echoing the rules back on a failed login would tell an
  // attacker what shape of password to guess.
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Digits in an emailed sign-in code. */
export const LOGIN_CODE_LENGTH = 6;

/**
 * An emailed sign-in code, as a person types it.
 *
 * Spaces and dashes are dropped before the check, because a code read off an
 * email is often typed or pasted as "123 456", and rejecting that for its
 * formatting is a failure the person cannot see the reason for.
 */
export const loginCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(new RegExp(`^\\d{${LOGIN_CODE_LENGTH}}$`), 'Enter the 6-digit code'));

/** Why a code is wanted: to sign in to an account, or to create one. */
export const LOGIN_CODE_PURPOSES = ['login', 'register'] as const;
export type LoginCodePurpose = (typeof LOGIN_CODE_PURPOSES)[number];

/**
 * Body of `POST /api/auth/code`.
 *
 * A sign-up carries the new account's name; a sign-in has nothing but the
 * address. The two are different requests rather than one "continue with
 * email", because the sign-up page already has the name and the sign-in page
 * must never create an account by accident.
 */
export const requestLoginCodeSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), email: emailSchema }),
  z.object({
    purpose: z.literal('register'),
    email: emailSchema,
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  }),
]);
export type RequestLoginCodeInput = z.infer<typeof requestLoginCodeSchema>;

/** Body of `POST /api/auth/code/verify`. */
export const verifyLoginCodeSchema = z.object({
  email: emailSchema,
  code: loginCodeSchema,
});
export type VerifyLoginCodeInput = z.infer<typeof verifyLoginCodeSchema>;

/**
 * Response of `POST /api/auth/code`: the same for every address, whether or not
 * an account exists and whether or not a code was sent, so the response cannot
 * be used to find out who has an account.
 */
export const loginCodeSentSchema = z.object({
  /** How long the code stays valid. */
  expiresInSec: z.number().int().positive(),
  /** How long before another code may be requested for the address. */
  resendAfterSec: z.number().int().positive(),
});
export type LoginCodeSent = z.infer<typeof loginCodeSentSchema>;

/**
 * Response of register / login / refresh / demo.
 *
 * The refresh token is deliberately absent: it travels only as an httpOnly
 * cookie, so JavaScript - and therefore any XSS payload - cannot read it.
 * The access token is returned in the body and held in memory by the client.
 */
export const authResponseSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string(),
  /** Lifetime of `accessToken`, so the client can refresh proactively. */
  expiresInSec: z.number().int().positive(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Name of the httpOnly cookie carrying the refresh token. */
export const REFRESH_COOKIE_NAME = 'intellmeet_rt';

/**
 * Path the refresh cookie is scoped to.
 *
 * Narrowing it to the auth routes means the cookie is not attached to the
 * hundreds of ordinary API calls that have no use for it, shrinking the
 * surface for both accidental logging and CSRF.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

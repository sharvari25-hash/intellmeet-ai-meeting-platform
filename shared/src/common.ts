import { z } from 'zod';

/**
 * A MongoDB ObjectId as it appears in JSON (24 hex characters).
 *
 * Validating the format at the edge means a malformed id is rejected with a
 * 400 before it ever reaches Mongoose, which would otherwise throw a
 * `CastError` that surfaces as a confusing 500.
 */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');
export type ObjectIdString = z.infer<typeof objectIdSchema>;

/** Route params of the form `/:id`. */
export const idParamsSchema = z.object({ id: objectIdSchema });

/**
 * Email normalisation, shared by every schema that accepts one.
 *
 * Trims and lower-cases *before* validating, so " Ada@Example.COM " is
 * accepted and stored as "ada@example.com". Without the normalisation the
 * same person could register twice with different casing, because the unique
 * index is byte-for-byte.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Must be a valid email address').max(254));

/**
 * A URL that is safe to put in an `href` or `src`.
 *
 * Plain URL validation is not enough: `javascript:alert(1)` and
 * `data:text/html,...` are both syntactically valid URLs, and either one
 * stored as an avatar and later rendered into an attribute is stored XSS.
 * Checking the parsed protocol rather than pattern-matching the string avoids
 * the usual bypasses (`JavaScript:`, leading whitespace, embedded newlines),
 * because `new URL()` normalises all of them before we look.
 */
export const httpsUrlSchema = z
  .string()
  .max(500)
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid https:// URL' },
  );

import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AUTH_PROVIDERS, USER_ROLES } from '@intellmeet/shared';

/**
 * One issued refresh token.
 *
 * Only the SHA-256 hash is stored. A database dump therefore yields nothing
 * replayable, exactly as with passwords - but SHA-256 rather than bcrypt,
 * because the token is 32 bytes of CSPRNG output. bcrypt's cost exists to slow
 * brute force against *low-entropy* secrets; against 256 bits of entropy it
 * would only add latency to every refresh.
 *
 * Rotated tokens are kept with `revokedAt` set rather than deleted: that
 * record is what makes reuse detection possible. If a token that was already
 * rotated away is presented again, it was captured by someone - and only the
 * affected *family* is revoked, not every session the account has.
 */
const refreshTokenSchema = new Schema(
  {
    hash: { type: String, required: true },

    /**
     * Identifies the sign-in this token descends from.
     *
     * One `POST /api/auth/login` (or `/demo`) starts a family; every rotation
     * inherits it. Revocation is scoped to a family, so a compromised session
     * cannot sign out the account's other devices or browser profiles.
     */
    familyId: { type: String, required: true },

    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
    ip: { type: String },

    // Written explicitly on every `$push`. A raw update operator does not go
    // through Mongoose's timestamp handling, and the value is load-bearing:
    // the per-user session cap sorts on it.
    createdAt: { type: Date, required: true, default: Date.now },

    revokedAt: { type: Date },
    /** Links a rotated token to its successor, for auditing a theft chain. */
    replacedByHash: { type: String },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // Optional because a future OAuth account would have no password. Also
    // `select: false`, so an accidental `User.findById(...)` followed by
    // `res.json(user)` cannot leak the hash - it has to be asked for by name.
    passwordHash: { type: String, select: false },

    /**
     * When somebody proved they can read this address, by entering the code
     * sent to it. Accounts made with a code have it from the start; ones made
     * with a password (`POST /api/auth/register`) do not, and nothing has
     * checked their address.
     *
     * That gap is what a code sign-in closes. Anyone can register an address
     * they do not own, with a password they know, and wait for its owner to
     * sign up; so the first time the owner proves the address with a code, the
     * unverified account's password and sessions are removed (auth.codes.ts).
     */
    emailVerifiedAt: { type: Date },
    avatarUrl: { type: String, default: null },
    role: { type: String, enum: USER_ROLES, default: 'member' },
    authProvider: { type: String, enum: AUTH_PROVIDERS, default: 'local' },
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
  },
  { timestamps: true },
);

// Finds the session for a presented refresh token in one indexed lookup,
// rather than loading every user and scanning their token arrays.
userSchema.index({ 'refreshTokens.hash': 1 });

// Every "Try Live Demo" counts the existing guests against the ceiling, and
// the demo cleanup looks guests up by provider; neither should scan every
// account to do it.
userSchema.index({ authProvider: 1 });

export type UserDocument = HydratedDocument<InferSchemaType<typeof userSchema>>;
export type RefreshTokenEntry = InferSchemaType<typeof refreshTokenSchema>;

export const User = model('User', userSchema);

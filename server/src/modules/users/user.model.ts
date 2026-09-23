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
 * rotated away is presented again, it was captured by someone, so every
 * session for that user is revoked.
 */
const refreshTokenSchema = new Schema(
  {
    hash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
    ip: { type: String },
    revokedAt: { type: Date },
    /** Links a rotated token to its successor, for auditing a theft chain. */
    replacedByHash: { type: String },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
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

export type UserDocument = HydratedDocument<InferSchemaType<typeof userSchema>>;
export type RefreshTokenEntry = InferSchemaType<typeof refreshTokenSchema>;

export const User = model('User', userSchema);

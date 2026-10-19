import { Schema, model, type InferSchemaType } from 'mongoose';
import { LOGIN_CODE_PURPOSES } from '@intellmeet/shared';

/**
 * The code most recently emailed to an address, waiting to be entered.
 *
 * One document per address, replaced when another code is requested: only the
 * newest code works, so a person who asks twice is never left holding two
 * valid codes, and an old email cannot be used after a new one arrives.
 *
 * Only an HMAC of the code is stored (auth.codes.ts), so a database dump holds
 * nothing that can be typed into the form.
 *
 * It lives in MongoDB, not Redis, for one reason: Render's free Key Value keeps
 * nothing on disk, and a restart there would turn every code in flight into
 * "invalid" (rate-limit counters and caches already live with that). A code
 * is worth ten minutes of a person's patience; the TTL index below removes
 * what nobody entered.
 */
const loginCodeSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    purpose: { type: String, enum: LOGIN_CODE_PURPOSES, required: true },

    /** The new account's name, kept until the code proves the address. */
    name: { type: String, trim: true, maxlength: 80 },

    codeHash: { type: String, required: true },

    /** Wrong guesses so far; the code stops working at `LOGIN_CODE_MAX_ATTEMPTS`. */
    attempts: { type: Number, required: true, default: 0 },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// MongoDB removes a document once its `expiresAt` has passed. Its monitor runs
// about once a minute, so queries also filter on `expiresAt` themselves: an
// expired code must never work for the minute it is waiting to be removed.
loginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LoginCodeEntry = InferSchemaType<typeof loginCodeSchema>;

export const LoginCode = model('LoginCode', loginCodeSchema);

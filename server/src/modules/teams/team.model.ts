import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { TEAM_ROLES } from '@intellmeet/shared';

const teamMemberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: TEAM_ROLES, default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * An invite code, stored in plain text on purpose.
 *
 * Unlike a refresh token, an invite code is meant to be copied into a chat
 * message and typed by hand, and its blast radius is "joins one team as a
 * member". Storing it hashed would prevent the team admin from ever seeing
 * the code again, which defeats the feature. It is short-lived and revocable
 * instead.
 */
const inviteCodeSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true },
    expiresAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revokedAt: { type: Date },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
);

const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Human-readable identifier for future `/t/:slug` URLs. Unique so two
    // teams called "Design" cannot collide.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [teamMemberSchema], default: [] },
    inviteCodes: { type: [inviteCodeSchema], default: [] },
  },
  { timestamps: true },
);

// "List the teams I belong to" is the single most frequent team query, and it
// runs on every page load of the app shell.
teamSchema.index({ 'members.userId': 1 });

// Redeeming an invite looks the code up across all teams.
teamSchema.index({ 'inviteCodes.code': 1 });

export type TeamDocument = HydratedDocument<InferSchemaType<typeof teamSchema>>;

export const Team = model('Team', teamSchema);

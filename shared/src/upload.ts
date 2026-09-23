import { z } from 'zod';

/**
 * Everything the browser needs to upload a file straight to Cloudinary.
 *
 * The file never passes through our server: the client POSTs it directly to
 * `uploadUrl` with these signed fields attached. That keeps large recordings
 * off Render's free tier (which has modest memory and request-size limits) and
 * means the API secret never leaves the backend - only a signature derived
 * from it, valid for one specific set of upload parameters.
 */
export const uploadSignatureSchema = z.object({
  cloudName: z.string(),
  /** Public key; safe to expose, unlike the API secret used to sign. */
  apiKey: z.string(),
  /** Unix seconds. Cloudinary rejects signatures older than one hour. */
  timestamp: z.number().int().positive(),
  signature: z.string(),
  folder: z.string(),
  /**
   * Cloudinary `context` metadata, tagging the asset with its uploader.
   * It is part of the signed parameter set, so the browser must send it back
   * verbatim or Cloudinary rejects the upload.
   */
  context: z.string(),
  /** Full endpoint to POST the multipart form to. */
  uploadUrl: z.string(),
});
export type UploadSignature = z.infer<typeof uploadSignatureSchema>;

/** Asset kinds the signature endpoint will sign for. */
export const UPLOAD_KINDS = ['avatar', 'recording'] as const;
export const uploadKindSchema = z.enum(UPLOAD_KINDS);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const uploadSignatureQuerySchema = z.object({
  kind: uploadKindSchema.default('avatar'),
});

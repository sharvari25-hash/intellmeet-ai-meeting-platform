import type { UploadKind, UploadSignature } from '@intellmeet/shared';
import { buildUploadUrl, getCloudinaryConfig, signUploadParams } from '../../config/cloudinary.js';
import { AppError } from '../../lib/errors.js';

/**
 * What each asset kind is allowed to become, server-side.
 *
 * The folder and resource type are baked into the signature, so the browser
 * cannot redirect an avatar upload into the recordings folder or change its
 * type - it can only upload exactly what was signed for. Anything the client
 * were allowed to choose freely would be an open upload endpoint on our
 * Cloudinary account.
 */
const UPLOAD_PRESETS: Record<UploadKind, { folder: string; resourceType: 'image' | 'video' }> = {
  avatar: { folder: 'intellmeet/avatars', resourceType: 'image' },
  recording: { folder: 'intellmeet/recordings', resourceType: 'video' },
};

/**
 * Produces the signed parameters for a direct browser-to-Cloudinary upload.
 *
 * The API secret never leaves the server: what the client receives is a
 * one-hour signature over this exact parameter set. The upload itself bypasses
 * our API entirely, which is what keeps meeting recordings off Render's free
 * tier.
 *
 * Returns a 503 rather than throwing an obscure error when Cloudinary is not
 * configured, so a deployment without credentials degrades to "uploads are
 * unavailable" instead of appearing broken.
 */
export function createUploadSignature(kind: UploadKind, userId: string): UploadSignature {
  const config = getCloudinaryConfig();

  if (!config) {
    throw AppError.unavailable(
      'File uploads are not configured on this deployment (Cloudinary credentials are missing).',
    );
  }

  const preset = UPLOAD_PRESETS[kind];
  const timestamp = Math.floor(Date.now() / 1000);

  // Signed parameters must match exactly what the browser sends, or Cloudinary
  // rejects the upload. `context` tags the asset with its uploader, which is
  // what makes orphaned-asset cleanup possible later.
  const context = `uploadedBy=${userId}`;
  const params: Record<string, string | number> = {
    folder: preset.folder,
    timestamp,
    context,
  };

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    signature: signUploadParams(params, config.apiSecret),
    folder: preset.folder,
    context,
    uploadUrl: buildUploadUrl(config.cloudName, preset.resourceType),
  };
}

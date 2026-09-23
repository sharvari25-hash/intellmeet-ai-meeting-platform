import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

/**
 * Cloudinary is optional infrastructure.
 *
 * The product works end to end without it - only avatar and recording uploads
 * are unavailable - so the credentials are optional env vars and every caller
 * goes through `getCloudinaryConfig()`, which returns `null` when they are
 * missing. That turns "no Cloudinary account yet" into one clear 503 on one
 * endpoint instead of a crash at startup or an obscure failure at upload time.
 */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function getCloudinaryConfig(): CloudinaryConfig | null {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;

  // All three or nothing: a partial configuration is a misconfiguration, and
  // silently treating it as "enabled" would produce signatures that Cloudinary
  // rejects with an unhelpful error.
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return null;

  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
  };
}

export function isCloudinaryConfigured(): boolean {
  return getCloudinaryConfig() !== null;
}

/**
 * Signs a set of upload parameters.
 *
 * Uses the SDK's own signing helper rather than reimplementing the algorithm
 * (sorted params, SHA-1, secret appended) so the signature cannot drift from
 * whatever Cloudinary expects. The secret is passed per call instead of via
 * the SDK's global `config()`, which keeps this function pure and trivially
 * testable with throwaway credentials.
 */
export function signUploadParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  return cloudinary.utils.api_sign_request(params, apiSecret);
}

/** Endpoint the browser POSTs the multipart form to. */
export function buildUploadUrl(cloudName: string, resourceType: 'image' | 'video'): string {
  return `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
}

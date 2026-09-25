/**
 * Cloudinary image delivery, sized for where the image is shown.
 *
 * An uploaded avatar is whatever the camera made - a phone photo can be
 * 4,000 pixels across and several megabytes - and it is shown 32 to 80 pixels
 * wide. Cloudinary transforms an image on the fly from its URL, so the fix is
 * a URL rather than a resize step anywhere:
 *
 * - `c_fill,g_face` crops a square around the face, so a portrait photo
 *   does not become a forehead in a circle;
 * - `w_`/`h_` at twice the CSS size, sharp on high-density screens;
 * - `f_auto` serves AVIF or WebP to browsers that take them;
 * - `q_auto` picks the lowest quality nobody would notice.
 *
 * Anything that is not a Cloudinary image upload URL (another host, a video
 * or raw file, a data URL) comes back untouched.
 */

const IMAGE_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

/** The density most screens now have; a 1x screen downsamples it for free. */
const DENSITY = 2;

export function cloudinaryImage(url: string, cssSize: number): string {
  const match = IMAGE_UPLOAD.exec(url);
  if (!match) return url;

  const [, prefix, rest] = match;
  const pixels = Math.round(cssSize * DENSITY);
  // Chained in front of whatever the URL already asks for (a version, or a
  // transformation of its own), which Cloudinary applies in order.
  return `${prefix}c_fill,g_face,w_${pixels},h_${pixels},f_auto,q_auto/${rest}`;
}

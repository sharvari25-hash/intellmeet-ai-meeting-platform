/**
 * Hands the browser a file to save.
 *
 * A temporary object URL on a temporary `<a download>`: the one approach that
 * works in every current browser without a library, and nothing is uploaded
 * anywhere - exports are built entirely on the device.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has started reading the Blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A file name from a title: lower-case words joined by hyphens, safe on
 * Windows, macOS and Linux, never empty.
 */
export function fileNameFrom(title: string, extension: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'meeting'}.${extension}`;
}

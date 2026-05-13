/**
 * Media URL normalization and proxying.
 *
 * Discord hosts assets on multiple CDN domains. Some (images-ext-*) wrap
 * external content behind a proxy URL. Others (media.discordapp.net) serve
 * stickers and emojis but have stricter hotlinking/CORS policies than
 * cdn.discordapp.com.
 *
 * normalizeMediaUrl unwraps proxy URLs and remaps known subdomains.
 * getProxiedUrl routes assets through the control-plane media proxy when
 * the origin is known to enforce hotlinking/CORS restrictions.
 */

/**
 * Unwrap Discord image proxy URLs and remap media.discordapp.net
 * to cdn.discordapp.com for stickers and emojis.
 */
export function normalizeMediaUrl(url: string): string {
  if (!url) return url;

  // Handle Discord external proxy:
  // https://images-ext-1.discordapp.net/external/.../https/media.tenor.com/...
  if (url.includes("images-ext-") && url.includes("/https/")) {
    const parts = url.split("/https/");
    if (parts.length > 1) return "https://" + parts[1];
  }

  // Convert media.discordapp.net to cdn.discordapp.com for stickers/emojis.
  // media subdomains are often more restricted or intended for dynamic resizing.
  if (
    url.includes("media.discordapp.net") &&
    (url.includes("/stickers/") || url.includes("/emojis/"))
  ) {
    return url.replace("media.discordapp.net", "cdn.discordapp.com");
  }

  return url;
}

/**
 * Route external media assets through the control-plane proxy to
 * avoid hotlinking and CORS issues.
 */
export function getProxiedUrl(url: string): string {
  if (!url) return url;
  const normalized = normalizeMediaUrl(url);
  const controlPlaneUrl = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || "";

  // Always proxy stickers to avoid CORS/Referer issues
  if (
    normalized.includes("discordapp.net/stickers/") ||
    normalized.includes("discordapp.com/stickers/")
  ) {
    return `${controlPlaneUrl}/v1/media/proxy?url=${encodeURIComponent(normalized)}`;
  }

  // Proxy Discord, Tenor, Giphy assets — strict hotlinking/CORS policies
  if (
    normalized.includes("discordapp.net") ||
    normalized.includes("discordapp.com") ||
    normalized.includes("tenor.com") ||
    normalized.includes("giphy.com")
  ) {
    return `${controlPlaneUrl}/v1/media/proxy?url=${encodeURIComponent(normalized)}`;
  }

  return normalized;
}

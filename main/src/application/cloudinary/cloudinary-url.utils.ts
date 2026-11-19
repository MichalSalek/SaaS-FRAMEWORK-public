const CLOUDINARY_UPLOAD_SEGMENT = '/upload/';

export const getCloudinaryThumbUrl = (
  url: string,
  width = 400,
  quality = 'auto'
): string => {
  if (!url.includes(CLOUDINARY_UPLOAD_SEGMENT)) {
    return url;
  }
  return url.replace(
    CLOUDINARY_UPLOAD_SEGMENT,
    `${CLOUDINARY_UPLOAD_SEGMENT}w_${width},q_${quality},f_auto/`
  );
};

/** Widths offered to the browser for a photo in a frame whose size follows the layout. */
const FRAME_WIDTHS = [200, 400, 800, 1200] as const;

/** Aspect of the frame the photo is drawn in, as Cloudinary writes it. */
export type CloudinaryFrameAspect = '1:1' | '3:4';

/**
 * DECISION: a photo in a frame is ordered so that the CDN crops to the frame's proportions (from
 * the centre, like `object-fit: cover`) and the browser picks the width from `srcSet` by `sizes`
 * and screen density. Two mechanisms made photos blurry: a fixed `w_N` next to a tile whose size
 * follows the layout (a 200 px version drawn at 350 px and 2x had 0.29 of the needed pixels), and
 * `object-fit: cover` on another aspect than the frame (`w_800` of a landscape source gives 533 px
 * of height for a frame 934 px tall). `getCloudinaryThumbUrl` stays for places with a fixed small
 * size. Measure with `npm run qa:images` (owner).
 */
export const getCloudinaryFrameUrl = (
  url: string,
  aspect: CloudinaryFrameAspect,
  width: number
): string => {
  if (!url.includes(CLOUDINARY_UPLOAD_SEGMENT)) {
    return url;
  }
  return url.replace(
    CLOUDINARY_UPLOAD_SEGMENT,
    `${CLOUDINARY_UPLOAD_SEGMENT}c_fill,ar_${aspect},w_${width},q_auto,f_auto/`
  );
};

/** `srcSet` for `getCloudinaryFrameUrl`; undefined for a URL the CDN cannot resize. */
export const getCloudinaryFrameSrcSet = (
  url: string,
  aspect: CloudinaryFrameAspect
): string | undefined => {
  if (!url.includes(CLOUDINARY_UPLOAD_SEGMENT)) {
    return undefined;
  }
  return FRAME_WIDTHS.map(
    width => `${getCloudinaryFrameUrl(url, aspect, width)} ${width}w`
  ).join(', ');
};

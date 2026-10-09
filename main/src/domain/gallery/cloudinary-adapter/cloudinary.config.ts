export const CLOUDINARY_UPLOAD_URL = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/image/upload` as const;

export const cloudinaryUploadPreset = 'ml_default' as const;

/**
 * Cloudinary upload flags for EXIF/metadata stripping.
 * GDPR compliance: removes GPS, device info, timestamps from uploaded images.
 * Add to FormData as `flags` parameter when uploading to Cloudinary.
 */
export const CLOUDINARY_UPLOAD_FLAGS = 'strip_profile' as const;

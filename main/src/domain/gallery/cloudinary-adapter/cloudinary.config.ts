export const CLOUDINARY_UPLOAD_URL = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/image/upload` as const;

export const cloudinaryUploadPreset = 'ml_default' as const;

export const CLOUDINARY_UPLOAD_FLAGS = 'strip_profile' as const;

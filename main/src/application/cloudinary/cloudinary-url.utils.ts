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

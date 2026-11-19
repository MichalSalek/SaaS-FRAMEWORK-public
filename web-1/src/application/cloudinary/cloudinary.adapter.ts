// Require the cloudinary library
import { v2 as cloudinary } from 'cloudinary';
import { ENV_VARS } from '@app/environment/environment.config';
import { HTTP_CLIENT_CONFIG } from '@kernel/application/constants.config';

// Return "https" URLs by setting secure: true
// timeout: 20s to prevent hung requests during Cloudinary outages
//
// DECISION: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_SECRET are 'optional' in env-schema.
// Upload and image display go DIRECTLY frontend -> Cloudinary (public cloud_name =
// NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME in main), not through the backend. These credentials gate only the
// best-effort orphan cleanup (cleanupCloudinaryAsset[s], fire-and-forget, errors logged not thrown);
// without them the cleanup is skipped and the health check reports 'unknown'. Cleanup needs all three
// (cloud_name alone without auth does not work).
cloudinary.config({
  secure: true,
  cloud_name: ENV_VARS.CLOUDINARY_CLOUD_NAME,
  api_key: ENV_VARS.CLOUDINARY_API_KEY,
  api_secret: ENV_VARS.CLOUDINARY_SECRET,
  timeout: HTTP_CLIENT_CONFIG.CLOUDINARY_TIMEOUT_MS,
});

export { cloudinary };

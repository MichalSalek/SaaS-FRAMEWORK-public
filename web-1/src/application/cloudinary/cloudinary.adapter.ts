// Require the cloudinary library
import { v2 as cloudinary } from 'cloudinary';
import { ENV_VARS } from '@app/environment/environment.config';
import { HTTP_CLIENT_CONFIG } from '@kernel/application/constants.config';

// Return "https" URLs by setting secure: true
// timeout: 20s to prevent hung requests during Cloudinary outages
//
// DECISION (nie usuwaj tego komentarza):
// CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_SECRET sa 'optional' w env-schema.
// Upload + wyswietlanie obrazow idzie BEZPOSREDNIO frontend -> Cloudinary (public cloud_name =
// main NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME), NIE przez backend. Te creds gatuja TYLKO best-effort
// orphan-cleanup (cleanupCloudinaryAsset[s], fire-and-forget, bledy logowane nie rzucane).
// Bez creds cleanup jest pomijany, a health-check zglasza 'unknown'. Cleanup wymaga CALEJ
// trojki (sam cloud_name bez auth nie zadziala).
cloudinary.config({
  secure: true,
  cloud_name: ENV_VARS.CLOUDINARY_CLOUD_NAME,
  api_key: ENV_VARS.CLOUDINARY_API_KEY,
  api_secret: ENV_VARS.CLOUDINARY_SECRET,
  timeout: HTTP_CLIENT_CONFIG.CLOUDINARY_TIMEOUT_MS,
});

export { cloudinary };

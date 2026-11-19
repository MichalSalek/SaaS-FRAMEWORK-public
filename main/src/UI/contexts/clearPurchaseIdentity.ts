import { clearUploadDraftMemory } from '../features/gallery/hooks/uploadDraftMemory';
import { clearPurchaseResume } from '../../application/client-device-storage/purchase-resume';
import { clearPurchaseChangeProof } from '../../application/client-device-storage/purchase-change-proof';

export function clearPurchaseIdentity(): void {
  clearUploadDraftMemory();
  clearPurchaseResume();
  clearPurchaseChangeProof();
}

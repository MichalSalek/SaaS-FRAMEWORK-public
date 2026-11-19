import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

const C = ADMIN_CONTRACTS;

export const adminGetPermissions_IO = contractEndpoint(C.ADMIN_GET_PERMISSIONS);
export const adminUpdatePermissions_IO = contractEndpoint(
  C.ADMIN_UPDATE_PERMISSIONS
);
export const adminGetFeatureFlags_IO = contractEndpoint(
  C.ADMIN_GET_FEATURE_FLAGS
);
export const adminToggleFeatureFlag_IO = contractEndpoint(
  C.ADMIN_TOGGLE_FEATURE_FLAG
);

// The public feature-flag read lives in application/feature-flags/client-feature-flags.ts.
// It still calls defineEndpoint(ENDPOINTS.GET_FEATURE_FLAGS_PUBLIC). This module does not own it.

export const adminGetPolicies_IO = contractEndpoint(C.ADMIN_GET_POLICIES);
export const adminSavePolicy_IO = contractEndpoint(C.ADMIN_SAVE_POLICY);
export const adminDeletePolicy_IO = contractEndpoint(C.ADMIN_DELETE_POLICY);
export const adminSetMainPolicy_IO = contractEndpoint(C.ADMIN_SET_MAIN_POLICY);
export const adminGetConfigs_IO = contractEndpoint(C.ADMIN_GET_CONFIGS);
export const adminUpdateConfig_IO = contractEndpoint(C.ADMIN_UPDATE_CONFIG);

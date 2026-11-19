import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

const C = ADMIN_CONTRACTS;

export const createColor_IO = contractEndpoint(C.ADMIN_CREATE_COLOR);
export const updateColor_IO = contractEndpoint(C.ADMIN_UPDATE_COLOR);
export const deleteColor_IO = contractEndpoint(C.ADMIN_DELETE_COLOR);
export const createTrait_IO = contractEndpoint(C.ADMIN_CREATE_TRAIT);
export const updateTrait_IO = contractEndpoint(C.ADMIN_UPDATE_TRAIT);
export const deleteTrait_IO = contractEndpoint(C.ADMIN_DELETE_TRAIT);

/**
 * User Administration Service
 *
 * Application-layer facade for user operations needed by the Admin domain.
 * Eliminates cross-domain dependency: Admin → User domain.
 * Admin domain imports only from this service, never from user domain directly.
 */

// DECISION (nie usuwaj tego komentarza):
// Application→domain barrel: intentional facade dla Admin→User dependency.
// Admin domain NIE importuje user/operations bezpośrednio — tylko z tego pliku.
// Trade-off: jeden kontrolowany "application→domain" import vs liczne "Admin→User" w domain.

import {
  disableUser_IO,
  enableUser_IO,
} from '@domain/user/operations/user-state.operations';
import { setPaymentStateByUserID_IO } from '@domain/user/operations/user-account.operations';
import {
  deleteUser_IO,
  getUser_IO,
} from '@domain/user/operations/user-crud.operations';

export {
  disableUser_IO as adminDisableUser,
  enableUser_IO as adminEnableUser,
  deleteUser_IO as adminDeleteUser,
  getUser_IO as adminGetUser,
  setPaymentStateByUserID_IO as adminSetPaymentState,
};

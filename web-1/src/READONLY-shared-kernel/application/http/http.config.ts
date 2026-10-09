// Hidden command for client devices to know they must clear stored value of this header.
// Example:
// Auth session will be deleted from DB. After that, backend call frontend to clear it from a client device too.
//
export const CLEAR_THIS_HEADER_COMMAND_VALUE = 'clearme';

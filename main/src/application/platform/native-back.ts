/** Overlays may consume hardware Back before the route or app loses focus. */
export const NATIVE_BACK_EVENT = 'nf:native-back';

export function consumeNativeBack(): boolean {
  return !window.dispatchEvent(
    new Event(NATIVE_BACK_EVENT, { cancelable: true })
  );
}

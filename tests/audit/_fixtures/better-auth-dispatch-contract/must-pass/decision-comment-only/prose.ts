/**
 * DECISION (nie usuwaj tego komentarza):
 * Hook-runner pisze ctx.context.returned oraz ctx.context.responseHeaders tuż
 * przed hooks.after. Czytamy je WYŁĄCZNIE przez akcesor.
 */
// Kiedyś stało tu ctx.context?.returned — dziś idzie to przez getDispatchReturned.
export const nothingToSeeHere = (): null => null;

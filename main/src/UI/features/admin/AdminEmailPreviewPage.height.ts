/**
 * Observe the mail document while its parent frame owns the displayed height.
 * The observer belongs to the mail document, not the parent document: their
 * layout delivery cycles differ. Writes also wait until the next frame.
 * Test: AdminEmailPreviewPage.height.test.ts (owning document; deferred writes; cleanup).
 */
export function observeMailHeight(
  frame: HTMLIFrameElement,
  onHeight: (height: number) => void
): () => void {
  const root = frame.contentDocument?.documentElement;
  const view = root?.ownerDocument.defaultView;
  if (!root || !view) {
    return () => undefined;
  }

  let scheduledFrame: number | null = null;
  let previousHeight: number | null = null;
  let disposed = false;

  const scheduleMeasurement = () => {
    if (disposed || scheduledFrame !== null) {
      return;
    }
    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = null;
      if (disposed) {
        return;
      }
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height !== previousHeight) {
        previousHeight = height;
        onHeight(height);
      }
    });
  };

  const observer = new view.ResizeObserver(scheduleMeasurement);
  observer.observe(root);
  scheduleMeasurement();

  return () => {
    disposed = true;
    observer.disconnect();
    if (scheduledFrame !== null) {
      cancelAnimationFrame(scheduledFrame);
    }
  };
}

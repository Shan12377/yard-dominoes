/**
 * Mobile browsers resize the visual viewport while their address bar appears
 * or disappears during an ordinary scroll. That is not a layout change: a
 * full app redraw there tears down the page under the player's finger.
 */
export function needsLayoutRenderForResize(previousWidth: number, nextWidth: number): boolean {
  return Math.abs(nextWidth - previousWidth) > 1;
}

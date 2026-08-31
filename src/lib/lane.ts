/**
 * The scrollLeft that brings a lane to rest clear of the pinned page.
 *
 * Worked out as a delta from where the lane is now, rather than from the
 * content's origin: beside a right-hand page the track is laid out in reverse,
 * where scrollLeft counts down from zero, and a delta is the same arithmetic
 * whichever way the lane runs.
 */
export function laneOffset(track: HTMLElement, lane: HTMLElement): number {
  const style = getComputedStyle(track)
  const trackBox = track.getBoundingClientRect()
  const laneBox = lane.getBoundingClientRect()
  const delta = isReversed(style)
    ? laneBox.right - (trackBox.right - (parseFloat(style.scrollPaddingRight) || 0))
    : laneBox.left - (trackBox.left + (parseFloat(style.scrollPaddingLeft) || 0))
  return track.scrollLeft + delta
}

/** Whether the lane runs right-to-left, which it does beside a right-hand page. */
export function isReversed(target: HTMLElement | CSSStyleDeclaration): boolean {
  const style = target instanceof HTMLElement ? getComputedStyle(target) : target
  return style.flexDirection === 'row-reverse'
}

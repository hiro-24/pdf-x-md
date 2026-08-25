/**
 * Where a lane sits inside its track's scroll content, less the track's own
 * scroll padding - which is the width of the pinned page. Scrolling to this
 * offset brings the lane to rest *beside* the page instead of behind it.
 */
export function laneOffset(track: HTMLElement, lane: HTMLElement): number {
  const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0
  const within = lane.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft
  return Math.max(0, within - pad)
}

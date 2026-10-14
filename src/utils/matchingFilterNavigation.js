// Saving filters always returns to the discovery tab, including direct entry.
// Dismiss an existing route instead of pushing a second tab tree behind a modal.
export function finishMatchingFilters(router) {
  router.dismissTo('/home');
}

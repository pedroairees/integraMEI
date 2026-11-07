// Invalidation only: no financial values, account identifiers or tokens are broadcast.
export const financialUpdateEvent = "integramei:financial-update";
export function notifyFinancialUpdate() {
  window.dispatchEvent(new Event(financialUpdateEvent));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(financialUpdateEvent);
      channel.postMessage("refresh");
      channel.close();
    } catch {
      // Restricted browser contexts still refresh on focus and on the polling interval.
      // A notification failure must never turn a committed posting into an apparent failure.
    }
  }
}

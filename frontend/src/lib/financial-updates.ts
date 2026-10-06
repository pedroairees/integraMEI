// Invalidation only: no financial values, account identifiers or tokens are broadcast.
export const financialUpdateEvent = "integramei:financial-update";
export function notifyFinancialUpdate() {
  window.dispatchEvent(new Event(financialUpdateEvent));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(financialUpdateEvent);
    channel.postMessage("refresh");
    channel.close();
  }
}

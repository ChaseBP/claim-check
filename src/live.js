// Live updates over a WebSocket subscription (no fromBlock, so no polling).
// The watcher sees every entity event on the chain; it reacts only to
//  - entities created by the trusted publisher (new list versions or events), and
//  - expiry extensions of a freshness lease the page already knows about.
// Results never depend on this channel: if it drops, the page still reads on demand.
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { webSocket } from "viem"
import { WS_URL, TRUSTED_CREATORS } from "../shared/config.js"

export function startLive({ leaseKeys, onPublisherWrite, onLeaseRenewed, onStatus }) {
  let unwatch = null
  let client = null
  const trusted = new Set(Object.keys(TRUSTED_CREATORS))

  function connect() {
    try {
      client = createPublicClient({ chain: tiramisu, transport: webSocket(WS_URL, { reconnect: { attempts: 5, delay: 2000 } }) })
      unwatch = client.watchEntityEvents({
        onEntityCreated: (e) => {
          if (trusted.has(String(e.owner).toLowerCase())) onPublisherWrite(e)
        },
        onExpiryExtended: (e) => {
          if (leaseKeys().has(String(e.entityKey).toLowerCase())) onLeaseRenewed(e)
        },
        onError: () => onStatus("paused"),
      })
      onStatus("live")
    } catch {
      onStatus("paused")
    }
  }

  function disconnect() {
    unwatch?.()
    unwatch = null
    onStatus("idle")
  }

  // Only hold a socket open while someone is looking at the page.
  document.addEventListener("visibilitychange", () => (document.hidden ? disconnect() : unwatch || connect()))
  if (!document.hidden) connect()
}

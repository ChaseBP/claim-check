// Shared by the web app, the CLI and the publisher, so every reader applies the same rules.

export const APP = "claim-check"
export const SCHEMA_VERSION = 1

// Tiramisu testnet.
export const RPC_URL = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const WS_URL = "wss://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const BLOCK_SECONDS = 2

// Wallets whose records readers trust, and in what role. Anyone can write entities
// tagged app=claim-check; readers ignore every creator not listed here.
export const TRUSTED_CREATORS = {
  "0xe33a7e038837a75f5bdd891afcfd48eae6a2b703": "publisher",
}

// Lifetimes. History is retained for two years and anyone may extend it.
// A freshness check is a 14-day lease that the publisher renews only after
// re-downloading the insurer's PDF and finding the same hash.
export const HISTORY_DAYS = 730
export const CHECK_LEASE_DAYS = 14

export const INSURERS = {
  "hdfc-ergo": "HDFC ERGO General Insurance",
}

# 🔮 isnad Trust Oracle

**On-chain trust scoring for AI agents on Solana.**

> Built for [Solana Frontier Hackathon](https://www.colosseum.org/) (Apr 6 – May 11, 2026)

## Problem

AI agents transacting on Solana have **no verifiable trust**. Anyone can deploy an agent, claim capabilities, and rug. Existing solutions (Agent Registry, FairScale) rely on self-reported or transaction-based reputation — nobody is actually **testing** agents.

## Solution

isnad Trust Oracle bridges off-chain multi-dimensional scoring to on-chain verifiable data:

- **Multi-dimensional scoring**: Provenance (30%), Track Record (35%), Presence (20%), Endorsements (15%)
- **Red-team certification**: 37 adversarial attack vectors across 3 tiers
- **On-chain verification**: Any Solana program can query trust scores via CPI
- **Evidence chains**: Every score update includes SHA-256 hash of evidence

## Architecture

```
isnad API (off-chain scoring engine)
  → Oracle Bridge (TypeScript service)
    → Solana Program (Anchor/Rust)
      → Any dApp reads trust via CPI / account fetch
```

### Solana Program (6 instructions)

| Instruction | Access | Description |
|------------|--------|-------------|
| `initialize` | Admin (once) | Creates oracle config |
| `set_authority` | Admin | Rotates oracle signer |
| `submit_score` | Authority | Write/update trust score |
| `issue_cert` | Authority | Issue certification badge |
| `check_trust` | Anyone | Check score ≥ threshold |
| `check_cert` | Anyone | Check cert validity |

### Account Types (PDAs)

- **OracleConfig** `["oracle_config"]` — singleton config
- **TrustScore** `["trust_score", agent_id]` — per-agent scores
- **CertBadge** `["cert_badge", agent_id]` — per-agent certifications

### Trust Tiers

| Tier | Score | Meaning |
|------|-------|---------|
| Unknown | 0-24 | No data |
| Emerging | 25-49 | Building trust |
| Established | 50-74 | Proven |
| Verified | 75-100 | Extensively validated |

### Certification Levels

| Level | Vectors | Red-team tier |
|-------|---------|---------------|
| Untested | 0 | — |
| Basic | ~10 | Tier 1 |
| Standard | ~25 | Tier 2 |
| Advanced | 37+ | Tier 3 |

## Quick Start

```bash
# Build
anchor build

# Test (8/8 passing)
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

### Oracle Bridge

```bash
cd oracle-bridge
npm install
ISNAD_API_KEY=... AUTHORITY_KEYPAIR_PATH=... npm run dev -- gendolf
```

### SDK Client

```typescript
import { IsnadOracleClient } from "isnad-oracle-bridge";
import { Connection } from "@solana/web3.js";

const client = new IsnadOracleClient(
  new Connection("https://api.devnet.solana.com"),
  "BhG84286N1HTG6cRmASZVNQNtFd7K98BsBrhfjYc7H31"
);

const score = await client.getTrustScore("gendolf");
const cert = await client.getCertBadge("gendolf");
const trusted = await client.isTrusted("gendolf", 50);
```

## Integration with 8004 Agent Registry

isnad complements the Solana Agent Registry as a **Validation Provider**:

1. Agent registers on 8004 → gets asset pubkey (NFT)
2. isnad scores agent → writes TrustScore on-chain
3. isnad feeds back to 8004 via `giveFeedback()` with custom tags
4. Other programs query both: "Is this agent registered AND trusted?"

## Live Stats

- **isnad.site** — live scoring engine with API
- **50+ days** continuous operation
- **Red-team partnership** with Jarvis Stark (37 vectors, 3 tiers)
- **B2B integrations** — PayLock, SkillFence, MCP Server

## License

MIT

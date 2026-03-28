# isnad Trust Oracle — Architecture

## Overview
On-chain trust scoring oracle for AI agents on Solana. Bridges isnad's off-chain multi-dimensional scoring engine to on-chain verifiable trust data.

## Program Structure

### Accounts (PDAs)

| Account | Seeds | Purpose |
|---------|-------|---------|
| `OracleConfig` | `["oracle_config"]` | Singleton. Stores authority (oracle signer), admin, counters |
| `TrustScore` | `["trust_score", agent_id]` | Per-agent. Multi-dimensional trust scores |
| `CertBadge` | `["cert_badge", agent_id]` | Per-agent. Red-team certification results |

### Instructions

| Instruction | Access | Description |
|------------|--------|-------------|
| `initialize` | Admin (once) | Creates OracleConfig, sets authority |
| `set_authority` | Admin | Rotates oracle authority key |
| `submit_score` | Authority | Creates/updates agent trust score |
| `issue_cert` | Authority | Issues/updates certification badge |
| `check_trust` | Anyone | Reads trust score, checks threshold |
| `check_cert` | Anyone | Reads cert badge, checks validity |

### Trust Dimensions (isnad v3 Scoring)

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Provenance | 30% | Code origin, dependencies, supply chain |
| Track Record | 35% | Historical performance, reliability |
| Presence | 20% | Platform presence, discoverability |
| Endorsements | 15% | Third-party validations, reviews |

### Trust Tiers

| Tier | Score Range | Meaning |
|------|------------|---------|
| Unknown | 0-24 | No data or very new |
| Emerging | 25-49 | Some history, building trust |
| Established | 50-74 | Proven track record |
| Verified | 75-100 | Extensively validated |

### Certification Levels

| Level | Vectors | Description |
|-------|---------|-------------|
| Untested | 0 | No adversarial testing |
| Basic | ~10 | Tier 1: Common attacks |
| Standard | ~25 | Tier 2: Advanced attacks |
| Advanced | 37+ | Tier 3: Expert-level red team |

## Data Flow

```
isnad API (off-chain)
  → Oracle Service (signs + submits tx)
    → Solana Program (stores on-chain)
      → Any dApp/program (reads via CPI or account fetch)
```

## Integration with 8004 Agent Registry

isnad oracle complements the 8004 Agent Registry:
- 8004 = agent identity (NFTs, metadata, self-reported reputation)
- isnad = independent trust validation (tested, scored, certified)

Integration path:
1. Agent registers on 8004 → gets asset pubkey
2. isnad scores agent → writes TrustScore on-chain
3. isnad feeds back to 8004 via `giveFeedback()` with isnad-specific tags
4. Other programs query both: "Is this agent registered AND trusted?"

## Security Model

- **Authority-gated writes**: Only the oracle authority (isnad backend signer) can submit scores and certs
- **Admin-gated config**: Only the admin can rotate the authority key
- **Score validation**: All scores clamped to 0-100, string lengths checked
- **init-if-needed**: Score/cert accounts created on first write, updated on subsequent writes
- **Evidence chain**: Each score update includes SHA-256 hash of evidence chain for auditability
- **Cert expiry**: Certifications expire after 90 days, requiring re-assessment

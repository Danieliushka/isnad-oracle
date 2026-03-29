# TEE Attestation Design — isnad 5th Dimension: Infrastructure Integrity

## Overview

TEE (Trusted Execution Environment) attestation proves an AI agent runs inside a secure hardware enclave. This is the 5th scoring dimension for isnad, measuring **Infrastructure Integrity**.

**New Scoring Formula:**
- Provenance: 25% (was 30%)
- Track Record: 30% (was 35%)
- Presence: 17% (was 20%)
- Endorsements: 13% (was 15%)
- **Infrastructure: 15% (NEW)**

## TEE Landscape (2026)

### Intel TDX (Trust Domain Extensions)
- Successor to SGX for server workloads
- DCAP (Data Center Attestation Primitives) **deprecated** → now **TrusTEE** project
- Attestation: Quote v4 format, signed by Intel QE (Quoting Enclave)
- Verification: Intel PCS (Provisioning Certification Service) or third-party verifiers

### AMD SEV-SNP (Secure Encrypted Virtualization - Secure Nested Paging)
- VM-level isolation with encrypted memory
- Attestation report: binary format with REPORT_DATA (64 bytes user data), MEASUREMENT (launch digest), VLEK signature
- Verification chain: VLEK cert → AMD root of trust (kdsintf.amd.com)
- Tool: `snpguest` (virtee/snpguest) for report generation + verification
- AWS EC2 supports SEV-SNP with VLEK signatures

### AWS Nitro Enclaves
- NSM (Nitro Security Module) based attestation
- Format: COSE_Sign1 document containing PCRs (Platform Configuration Registers)
  - PCR0: enclave image hash
  - PCR1: Linux kernel hash  
  - PCR2: application hash
  - PCR8: signing certificate
- Verification: AWS Nitro Attestation PKI (root cert from AWS)
- Tool: `aws-nitro-enclaves-cli`

### Confidential Containers Trustee
- **Multi-TEE verifier**: TDX, SEV-SNP, Nitro, CCA (Arm)
- Reference implementation for attestation verification
- Key Broker Service (KBS) + Attestation Service (AS)
- Can be self-hosted or used as library

### Confer (confer.to) — Reference Architecture
- Private AI inference via TEE
- Noise protocol handshake for secure channels
- dm-verity for filesystem integrity
- **Sigstore transparency log** for build reproducibility
- End-to-end encryption between client ↔ TEE enclave

## Sigstore Integration

**Rekor** = transparency log for software supply chain:
- REST API at `rekor.sigstore.dev`
- Stores signed attestations with inclusion proofs
- Cosign for signing/verifying container images + artifacts
- Bundle format: signature + certificate + Rekor entry (inclusion proof)

**isnad use**: Verify that agent's container/binary is logged in Rekor → proves build reproducibility + non-tampering.

## Solana Program Changes

### New Fields in TrustScore Account
```rust
pub struct TrustScore {
    // existing
    pub authority: Pubkey,
    pub agent_id: String,
    pub provenance_score: u8,    // 0-100
    pub track_record_score: u8,  // 0-100
    pub presence_score: u8,      // 0-100
    pub endorsement_score: u8,   // 0-100
    // NEW
    pub infra_score: u8,         // 0-100 (Infrastructure Integrity)
    pub attestation_hash: [u8; 32], // SHA-256 of latest attestation report
    pub tee_type: u8,            // 0=None, 1=IntelTDX, 2=AMDSEV, 3=Nitro, 4=Other
    pub last_attestation_ts: i64, // Unix timestamp of last attestation
}
```

### New Instruction: `submit_attestation`
```rust
pub fn submit_attestation(
    ctx: Context<SubmitAttestation>,
    agent_id: String,
    attestation_hash: [u8; 32],
    tee_type: u8,
    infra_score: u8,
) -> Result<()>
```

### Total Score Calculation (on-chain)
```
total = (provenance * 25 + track_record * 30 + presence * 17 + endorsement * 13 + infra * 15) / 100
```

## Oracle Bridge Changes

New functions in bridge service:
1. `verifyAttestation(report, teeType)` → validate signature chain
2. `checkTransparencyLog(imageHash)` → query Rekor for matching entry
3. `computeInfraScore(attestation, transparencyLog)` → 0-100 score

### Scoring Logic
| Factor | Weight | Source |
|--------|--------|--------|
| Valid TEE attestation | 40% | Hardware report signature verification |
| Fresh attestation (<24h) | 20% | Timestamp check |
| Reproducible build (Sigstore) | 25% | Rekor transparency log lookup |
| Known TEE platform | 15% | Intel/AMD/AWS root cert chain |

## Implementation Plan

1. **Solana Program Update** — Add infra_score, attestation_hash, tee_type fields + submit_attestation instruction
2. **Oracle Bridge Update** — Add verifyAttestation() + checkTransparencyLog() + computeInfraScore()
3. **8004-solana Integration** — Demo agent registering with TEE attestation
4. **Tests** — Unit tests for scoring, integration tests on devnet
5. **Demo** — Agent running in Nitro Enclave, attesting, getting scored

## Security Considerations

- Attestation reports can be replayed → require freshness (nonce/timestamp)
- Oracle bridge is trusted party → future: on-chain verification via BPF or ZK proofs
- TEE escape attacks exist → attestation = evidence, not guarantee
- Score decay: infra_score decreases if attestation older than 24h (stale = less trustworthy)

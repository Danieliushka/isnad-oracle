# TEE Attestation Research — isnad Infrastructure Integrity Dimension

## Overview

TEE (Trusted Execution Environment) attestation provides hardware-enforced proof that code is running in an isolated environment where even the host operator cannot see memory/execution state.

## TEE Platforms

### 1. Intel TDX (Trust Domain Extensions)
- **What:** VM-level isolation. Full VM runs in encrypted memory.
- **Attestation:** DCAP (Data Center Attestation Primitives). Quote contains: CPU SVN, measurements (MRTD, RTMR), report data.
- **Verification:** Intel Trust Authority API or self-hosted via TrusTEE/Confidential Containers Attestation Service (AS)
- **Availability:** GCP C3 machines, Azure DCesv5
- **Quote format:** ECDSA-signed, contains TDREPORT with measurements

### 2. AMD SEV-SNP (Secure Encrypted Virtualization - Secure Nested Paging)
- **What:** VM memory encryption + integrity. Host can't read/modify guest memory.
- **Attestation:** Attestation report signed by AMD's VCEK (Versioned Chip Endorsement Key)
- **Verification:** AMD KDS (Key Distribution Service) provides cert chain
- **Availability:** GCP N2D, Azure DCasv5, AWS (via Nitro + SEV-SNP)
- **Quote format:** Signed report with MEASUREMENT (launch digest), HOST_DATA, REPORT_DATA

### 3. AWS Nitro Enclaves
- **What:** Isolated compute environment within EC2. No persistent storage, no network, no admin access.
- **Attestation:** NSM (Nitro Secure Module) API. Attestation document = CBOR-encoded, signed by AWS Nitro PKI.
- **Verification:** Parse CBOR, verify certificate chain against AWS Nitro root CA, check PCR values.
- **Availability:** Most EC2 instance types
- **Quote format:** CBOR with PCRs (Platform Configuration Registers): PCR0 = enclave image, PCR1 = kernel, PCR2 = application
- **Simplest to verify** — well-documented, AWS root CA is public

### 4. Confidential Containers / TrusTEE (CNCF)
- **What:** Unified attestation framework across TEE types (TDX, SEV-SNP, SGX)
- **Components:** Attestation Service (AS) = verifier, Key Broker Service (KBS) = secret delivery
- **API:** REST, accepts evidence from any TEE type, returns attestation result
- **GitHub:** github.com/confidential-containers/trustee
- **Best for:** Platform-agnostic verification

## Sigstore Transparency Log
- **API:** `https://rekor.sigstore.dev/api/v1/log/entries`
- **Search:** `https://search.sigstore.dev`
- **What:** Append-only log of build signatures. Can verify that a binary was built from specific source at specific time.
- **For isnad:** Verify that an agent's binary matches a known-good reproducible build

## isnad Integration Design

### What We Verify
1. **TEE Type** — Is the agent running in a TEE? Which one? (TDX/SEV-SNP/Nitro)
2. **Attestation Validity** — Is the quote signed by genuine hardware? (verify cert chain)
3. **Measurements Match** — Do the measurements match a known-good build? (compare with transparency log)
4. **Freshness** — Is the attestation recent? (check timestamp, max 24h)

### Scoring
- No TEE: `infra_score = 0`, `infra_verified = false`
- TEE detected but unverifiable: `infra_score = 20`
- TEE verified, measurements unknown: `infra_score = 50`
- TEE verified, measurements match transparency log: `infra_score = 80`
- TEE verified, measurements match, reproducible build confirmed: `infra_score = 100`

### Implementation Priority
1. **AWS Nitro** — simplest attestation format, best docs, public root CA
2. **TrusTEE/CoCo AS** — platform-agnostic REST API, handles TDX + SEV-SNP
3. **Direct TDX/SEV-SNP** — if needed for specific partners

### Hackathon MVP Scope
For the hackathon, we DON'T need to run actual TEE hardware. We need:
- [ ] Solana program: `submit_attestation` instruction with TEE type, measurements, quote hash
- [ ] Oracle bridge: `verifyAttestation()` that validates quote structure and cert chain
- [ ] Demo: simulate attestation flow with mock TEE quotes (clearly labeled as demo)
- [ ] Docs: explain the full production flow even if demo uses mock data

### API Endpoint
```
POST /api/v1/attestation/verify
Body: {
  "agent_id": "string",
  "tee_type": "nitro" | "tdx" | "sev_snp" | "unknown",
  "attestation_quote": "base64-encoded quote",
  "build_hash": "sha256 of binary",
  "transparency_log_entry": "sigstore log entry URL (optional)"
}
Response: {
  "infra_score": 0-100,
  "infra_verified": bool,
  "tee_type": "string",
  "measurements_match": bool,
  "attestation_fresh": bool,
  "details": { ... }
}
```

## References
- Confer blog: confer.to/blog/2026/01/private-inference/
- Intel Trust Authority: docs.trustauthority.intel.com
- AWS Nitro attestation: github.com/aws/aws-nitro-enclaves-nsm-api
- TrusTEE: github.com/confidential-containers/trustee
- Sigstore: sigstore.dev, rekor.sigstore.dev
- Google CoCo docs: cloud.google.com/confidential-computing

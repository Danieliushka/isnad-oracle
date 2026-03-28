/**
 * Demo: isnad Trust Oracle × 8004 Agent Registry Integration
 * 
 * Shows how isnad trust scores flow into the 8004 ecosystem:
 * 1. Read isnad trust score from our oracle program
 * 2. Submit as 8004 feedback with isnad-specific tags
 * 3. Query combined data (8004 identity + isnad trust)
 * 
 * This is a conceptual demo — full integration requires
 * both programs deployed on the same cluster.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { IsnadOracleClient } from "./index";

// isnad custom tags for 8004 feedback
const ISNAD_TAGS = {
  // tag1 values
  TRUST_SCORE: "isnad:trust",        // Overall trust score (0-100)
  RED_TEAM_CERT: "isnad:cert",       // Red-team certification
  PROVENANCE: "isnad:provenance",    // Provenance dimension
  TRACK_RECORD: "isnad:track_record",
  PRESENCE: "isnad:presence",
  ENDORSEMENTS: "isnad:endorsements",
  
  // tag2 values  
  TIER_UNKNOWN: "isnad:tier:unknown",
  TIER_EMERGING: "isnad:tier:emerging",
  TIER_ESTABLISHED: "isnad:tier:established",
  TIER_VERIFIED: "isnad:tier:verified",
  CERT_BASIC: "isnad:cert:basic",
  CERT_STANDARD: "isnad:cert:standard",
  CERT_ADVANCED: "isnad:cert:advanced",
};

/**
 * Build 8004-compatible feedback from isnad trust score.
 * 
 * Usage with 8004-solana SDK:
 * ```
 * const feedback = buildIsnadFeedback(trustScore);
 * await sdk8004.giveFeedback(agentAsset, feedback);
 * ```
 */
function buildIsnadFeedback(score: {
  overall: number;
  tier: string;
  provenance: number;
  trackRecord: number;
  presence: number;
  endorsements: number;
}) {
  const tierTag = score.tier === "VERIFIED" ? ISNAD_TAGS.TIER_VERIFIED
    : score.tier === "ESTABLISHED" ? ISNAD_TAGS.TIER_ESTABLISHED
    : score.tier === "EMERGING" ? ISNAD_TAGS.TIER_EMERGING
    : ISNAD_TAGS.TIER_UNKNOWN;

  return {
    score: score.overall,
    value: BigInt(score.overall * 100), // 2 decimal precision
    valueDecimals: 2,
    tag1: ISNAD_TAGS.TRUST_SCORE,
    tag2: tierTag,
    feedbackUri: "", // Could link to isnad.site/agent/{id}
  };
}

function buildIsnadCertFeedback(cert: {
  level: string;
  vectorsTested: number;
  vectorsBlocked: number;
  blockRate: number;
}) {
  const certTag = cert.level === "ADVANCED" ? ISNAD_TAGS.CERT_ADVANCED
    : cert.level === "STANDARD" ? ISNAD_TAGS.CERT_STANDARD
    : ISNAD_TAGS.CERT_BASIC;

  return {
    score: Math.round(cert.blockRate / 100), // basis points → 0-100
    value: BigInt(cert.vectorsBlocked),
    valueDecimals: 0,
    tag1: ISNAD_TAGS.RED_TEAM_CERT,
    tag2: certTag,
  };
}

/**
 * Trust-gated access pattern:
 * Before allowing an agent to interact with your protocol,
 * check both 8004 registration AND isnad trust.
 */
async function trustGatedAccess(
  isnadClient: IsnadOracleClient,
  agentId: string,
  minTrustScore: number = 50,
): Promise<{ allowed: boolean; reason: string }> {
  // Step 1: Check isnad trust score
  const score = await isnadClient.getTrustScore(agentId);
  if (!score || !score.exists) {
    return { allowed: false, reason: "No isnad trust score found" };
  }

  // Step 2: Check isnad certification (optional but recommended)
  const cert = await isnadClient.getCertBadge(agentId);
  const hasCert = cert && cert.exists;

  // Step 3: Combined decision
  // In production, you'd deserialize the account data to check actual scores
  const trusted = await isnadClient.isTrusted(agentId, minTrustScore);
  
  if (!trusted) {
    return { allowed: false, reason: `Trust score below ${minTrustScore}` };
  }

  return {
    allowed: true,
    reason: hasCert
      ? "Trusted + Certified"
      : "Trusted (no certification)",
  };
}

// Demo flow
async function demo() {
  console.log("🔮 isnad × 8004 Integration Demo\n");

  // 1. Show tag taxonomy
  console.log("📋 isnad Custom Tags for 8004 Feedback:");
  console.log(JSON.stringify(ISNAD_TAGS, null, 2));

  // 2. Build sample feedback
  const sampleScore = {
    overall: 55,
    tier: "ESTABLISHED",
    provenance: 60,
    trackRecord: 50,
    presence: 45,
    endorsements: 40,
  };

  const feedback = buildIsnadFeedback(sampleScore);
  console.log("\n📊 8004 Feedback from isnad score:");
  console.log(JSON.stringify(feedback, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  // 3. Build cert feedback
  const sampleCert = {
    level: "ADVANCED",
    vectorsTested: 37,
    vectorsBlocked: 37,
    blockRate: 10000,
  };

  const certFeedback = buildIsnadCertFeedback(sampleCert);
  console.log("\n🛡️ 8004 Feedback from isnad certification:");
  console.log(JSON.stringify(certFeedback, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  // 4. Show trust-gated access pattern
  console.log("\n🔐 Trust-Gated Access Pattern:");
  console.log("  1. Check isnad TrustScore PDA");
  console.log("  2. Verify score >= threshold");
  console.log("  3. (Optional) Check CertBadge PDA");
  console.log("  4. Allow/deny agent access");

  console.log("\n✅ Integration demo complete");
}

export { ISNAD_TAGS, buildIsnadFeedback, buildIsnadCertFeedback, trustGatedAccess };

if (require.main === module) {
  demo().catch(console.error);
}

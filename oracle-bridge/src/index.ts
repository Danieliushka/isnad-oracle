/**
 * isnad Oracle Bridge
 * 
 * Reads trust scores from isnad API and writes them on-chain
 * to the isnad Trust Oracle Solana program.
 * 
 * Flow:
 * 1. Fetch agent score from isnad API (/api/v1/check/:agent_id)
 * 2. Map isnad score → TrustTier enum
 * 3. Create SHA-256 evidence hash from API response
 * 4. Submit transaction to Solana program (submit_score instruction)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

// Load IDL
const IDL_PATH = path.resolve(__dirname, "../../target/idl/isnad_oracle.json");

interface IsnadScore {
  agent_id: string;
  overall_score: number;
  tier: string;
  dimensions: {
    provenance: number;
    track_record: number;
    presence: number;
    endorsements: number;
  };
}

interface BridgeConfig {
  isnadApiUrl: string;
  isnadApiKey: string;
  solanaRpcUrl: string;
  programId: string;
  authorityKeypairPath: string;
}

function loadConfig(): BridgeConfig {
  return {
    isnadApiUrl: process.env.ISNAD_API_URL || "https://isnad.site/api/v1",
    isnadApiKey: process.env.ISNAD_API_KEY || "",
    solanaRpcUrl: process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"),
    programId: process.env.PROGRAM_ID || "BhG84286N1HTG6cRmASZVNQNtFd7K98BsBrhfjYc7H31",
    authorityKeypairPath: process.env.AUTHORITY_KEYPAIR_PATH || "",
  };
}

function mapTier(score: number): { [key: string]: {} } {
  if (score >= 75) return { verified: {} };
  if (score >= 50) return { established: {} };
  if (score >= 25) return { emerging: {} };
  return { unknown: {} };
}

function mapCertLevel(vectorsTested: number): { [key: string]: {} } {
  if (vectorsTested >= 37) return { advanced: {} };
  if (vectorsTested >= 25) return { standard: {} };
  if (vectorsTested >= 10) return { basic: {} };
  return { untested: {} };
}

function evidenceHash(data: any): number[] {
  const hash = createHash("sha256")
    .update(JSON.stringify(data))
    .digest();
  return Array.from(hash);
}

async function fetchIsnadScore(config: BridgeConfig, agentId: string): Promise<IsnadScore | null> {
  const url = `${config.isnadApiUrl}/check/${agentId}`;
  try {
    const resp = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${config.isnadApiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) {
      console.error(`isnad API error: ${resp.status} ${resp.statusText}`);
      return null;
    }
    const data = await resp.json() as any;
    return {
      agent_id: agentId,
      overall_score: data.score || 0,
      tier: data.tier || "UNKNOWN",
      dimensions: {
        provenance: data.dimensions?.provenance || 0,
        track_record: data.dimensions?.track_record || 0,
        presence: data.dimensions?.presence || 0,
        endorsements: data.dimensions?.endorsements || 0,
      },
    };
  } catch (err) {
    console.error(`Failed to fetch score for ${agentId}:`, err);
    return null;
  }
}

async function submitScoreOnChain(
  program: Program,
  authority: Keypair,
  score: IsnadScore,
): Promise<string> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    program.programId
  );
  const [scorePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trust_score"), Buffer.from(score.agent_id)],
    program.programId
  );

  const tx = await program.methods
    .submitScore(
      score.agent_id,
      score.overall_score,
      score.dimensions.provenance,
      score.dimensions.track_record,
      score.dimensions.presence,
      score.dimensions.endorsements,
      mapTier(score.overall_score),
      evidenceHash(score),
    )
    .accounts({
      config: configPda,
      authority: authority.publicKey,
      trustScore: scorePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  return tx;
}

async function submitCertOnChain(
  program: Program,
  authority: Keypair,
  agentId: string,
  vectorsTested: number,
  vectorsBlocked: number,
  testerId: string,
  reportData: any,
): Promise<string> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    program.programId
  );
  const [certPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("cert_badge"), Buffer.from(agentId)],
    program.programId
  );

  const tx = await program.methods
    .issueCert(
      agentId,
      mapCertLevel(vectorsTested),
      vectorsTested,
      vectorsBlocked,
      testerId,
      evidenceHash(reportData),
    )
    .accounts({
      config: configPda,
      authority: authority.publicKey,
      certBadge: certPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  return tx;
}

// ==================== SDK CLIENT ====================

/**
 * IsnadOracleClient — TypeScript SDK for reading trust data
 * 
 * Usage:
 *   const client = new IsnadOracleClient(connection, programId);
 *   const score = await client.getTrustScore("gendolf");
 *   const cert = await client.getCertBadge("gendolf");
 *   const isTrusted = await client.isTrusted("gendolf", 50);
 */
export class IsnadOracleClient {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection, programId: string | PublicKey) {
    this.connection = connection;
    this.programId = typeof programId === "string" ? new PublicKey(programId) : programId;
  }

  getTrustScorePda(agentId: string): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      this.programId
    );
    return pda;
  }

  getCertBadgePda(agentId: string): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("cert_badge"), Buffer.from(agentId)],
      this.programId
    );
    return pda;
  }

  async getTrustScore(agentId: string): Promise<any | null> {
    const pda = this.getTrustScorePda(agentId);
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;
    // Decode using Anchor's IDL-based deserialization would go here
    // For now, return raw account data indicator
    return { exists: true, address: pda.toBase58(), dataLen: info.data.length };
  }

  async getCertBadge(agentId: string): Promise<any | null> {
    const pda = this.getCertBadgePda(agentId);
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;
    return { exists: true, address: pda.toBase58(), dataLen: info.data.length };
  }

  async isTrusted(agentId: string, minScore: number): Promise<boolean> {
    const score = await this.getTrustScore(agentId);
    if (!score) return false;
    // Full implementation would deserialize and check score.overall >= minScore
    return score.exists;
  }
}

// ==================== MAIN ====================

async function main() {
  console.log("🔮 isnad Oracle Bridge starting...");
  
  const config = loadConfig();
  
  if (!config.isnadApiKey) {
    console.error("ISNAD_API_KEY not set");
    process.exit(1);
  }
  
  if (!config.authorityKeypairPath) {
    console.error("AUTHORITY_KEYPAIR_PATH not set");
    process.exit(1);
  }

  // Load authority keypair
  const keypairData = JSON.parse(fs.readFileSync(config.authorityKeypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  // Connect to Solana
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load program
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const programId = new PublicKey(config.programId);
  const program = new Program(idl, provider);

  // Example: sync a single agent
  const agentId = process.argv[2] || "gendolf";
  console.log(`Fetching isnad score for: ${agentId}`);

  const score = await fetchIsnadScore(config, agentId);
  if (!score) {
    console.error("Failed to fetch score");
    process.exit(1);
  }

  console.log(`Score: ${score.overall_score} (${score.tier})`);
  console.log(`Dimensions: P=${score.dimensions.provenance} TR=${score.dimensions.track_record} PR=${score.dimensions.presence} E=${score.dimensions.endorsements}`);

  try {
    const tx = await submitScoreOnChain(program, authority, score);
    console.log(`✅ Score submitted on-chain: ${tx}`);
  } catch (err) {
    console.error("Failed to submit on-chain:", err);
  }
}

// Export for SDK use
export { fetchIsnadScore, submitScoreOnChain, submitCertOnChain, mapTier, mapCertLevel, evidenceHash };
export type { IsnadScore, BridgeConfig };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

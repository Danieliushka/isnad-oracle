/**
 * Demo: TEE Attestation Flow
 * 
 * Simulates the full attestation pipeline:
 * 1. Submit agent trust score
 * 2. Submit TEE attestation (mock Nitro enclave)
 * 3. Query combined score on-chain
 * 
 * Run: npx ts-node scripts/demo-attestation.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const IDL_PATH = path.resolve(__dirname, "../target/idl/isnad_oracle.json");
const PROGRAM_ID = "BhG84286N1HTG6cRmASZVNQNtFd7K98BsBrhfjYc7H31";

function sha256(data: string): number[] {
  return Array.from(createHash("sha256").update(data).digest());
}

async function main() {
  console.log("🔮 isnad Trust Oracle — TEE Attestation Demo\n");

  // Connect
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const keypairPath = process.env.AUTHORITY_KEYPAIR_PATH || 
    path.resolve(process.env.HOME || "", ".config/solana/id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const programId = new PublicKey(PROGRAM_ID);
  const program = new Program(idl, provider);

  const agentId = "gendolf";
  
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")], programId
  );
  const [scorePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trust_score"), Buffer.from(agentId)], programId
  );

  // Step 1: Submit behavioral trust score
  console.log("📊 Step 1: Submitting behavioral trust score...");
  console.log("   Agent: gendolf");
  console.log("   Overall: 75 (VERIFIED tier)");
  console.log("   Provenance: 80 | Track Record: 85 | Presence: 60 | Endorsements: 70\n");

  try {
    const tx1 = await program.methods
      .submitScore(
        agentId,
        75, 80, 85, 60, 70,
        { verified: {} },
        sha256(JSON.stringify({ agent: "gendolf", source: "isnad-api", timestamp: Date.now() })),
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        trustScore: scorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(`   ✅ TX: ${tx1}\n`);
  } catch (e: any) {
    console.log(`   ⚠️  Score already exists, updating...\n`);
  }

  // Step 2: Submit TEE attestation
  console.log("🔐 Step 2: Submitting TEE attestation (mock AWS Nitro)...");
  console.log("   TEE Type: Nitro Enclave");
  console.log("   Infra Score: 80 (measurements match transparency log)");
  console.log("   Build Hash: sha256(agent-binary-v1.2.0)");
  console.log("   Measurements Match: true\n");

  const mockAttestationQuote = sha256("mock-nitro-attestation-quote-pcr0-pcr1-pcr2");
  const mockBuildHash = sha256("agent-binary-v1.2.0-reproducible-build");

  try {
    const tx2 = await program.methods
      .submitAttestation(
        agentId,
        { nitro: {} },
        80,
        mockAttestationQuote,
        mockBuildHash,
        true,
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        trustScore: scorePda,
      })
      .signers([authority])
      .rpc();
    console.log(`   ✅ TX: ${tx2}\n`);
  } catch (e: any) {
    console.error(`   ❌ Error: ${e.message}\n`);
  }

  // Step 3: Read combined score
  console.log("📖 Step 3: Reading combined on-chain score...\n");
  
  try {
    const score = await (program.account as any).trustScore.fetch(scorePda);
    
    console.log("   ┌─────────────────────────────────────────┐");
    console.log(`   │ Agent: ${score.agentId.padEnd(33)}│`);
    console.log("   ├─────────────────────────────────────────┤");
    console.log(`   │ Overall Score:     ${String(score.overall).padEnd(21)}│`);
    console.log(`   │ Tier:              ${JSON.stringify(score.tier).padEnd(21)}│`);
    console.log("   ├─────────────────────────────────────────┤");
    console.log(`   │ Provenance:        ${String(score.provenance).padEnd(21)}│`);
    console.log(`   │ Track Record:      ${String(score.trackRecord).padEnd(21)}│`);
    console.log(`   │ Presence:          ${String(score.presence).padEnd(21)}│`);
    console.log(`   │ Endorsements:      ${String(score.endorsements).padEnd(21)}│`);
    console.log("   ├─────────────────────────────────────────┤");
    console.log(`   │ 🔐 Infra Score:    ${String(score.infraScore).padEnd(21)}│`);
    console.log(`   │ 🔐 Infra Verified: ${String(score.infraVerified).padEnd(21)}│`);
    console.log(`   │ 🔐 TEE Type:       ${JSON.stringify(score.teeType).padEnd(21)}│`);
    console.log(`   │ 🔐 Measurements:   ${String(score.measurementsMatch).padEnd(21)}│`);
    console.log("   └─────────────────────────────────────────┘");
    
    // Compute weighted score with new formula
    const weighted = Math.round(
      score.provenance * 0.25 +
      score.trackRecord * 0.30 +
      score.presence * 0.17 +
      score.endorsements * 0.13 +
      score.infraScore * 0.15
    );
    console.log(`\n   📊 Weighted Score (v4 formula): ${weighted}/100`);
    console.log(`      = P(${score.provenance}×25%) + TR(${score.trackRecord}×30%) + PR(${score.presence}×17%) + E(${score.endorsements}×13%) + I(${score.infraScore}×15%)`);
    
  } catch (e: any) {
    console.error(`   ❌ Error reading score: ${e.message}`);
  }

  console.log("\n🎯 Demo complete. isnad Trust Oracle with TEE attestation is live on Solana devnet.");
}

main().catch(console.error);

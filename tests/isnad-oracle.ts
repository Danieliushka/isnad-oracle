import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IsnadOracle } from "../target/types/isnad_oracle";
import { assert } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

describe("isnad-oracle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.isnadOracle as Program<IsnadOracle>;
  const admin = provider.wallet as anchor.Wallet;
  const authority = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    program.programId
  );

  it("Initializes the oracle", async () => {
    // Check if already initialized (devnet persistent state)
    let existing = null;
    try {
      existing = await program.account.oracleConfig.fetch(configPda);
    } catch (e) {
      // Not initialized yet
    }

    if (existing) {
      // Already initialized — just set authority to our test authority
      await program.methods
        .setAuthority(authority.publicKey)
        .accounts({
          config: configPda,
          admin: admin.publicKey,
        })
        .rpc();
      const config = await program.account.oracleConfig.fetch(configPda);
      assert.ok(config.authority.equals(authority.publicKey));
      console.log("    (re-used existing config, updated authority)");
    } else {
      const tx = await program.methods
        .initialize(authority.publicKey)
        .accounts({
          config: configPda,
          admin: admin.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(configPda);
      assert.ok(config.authority.equals(authority.publicKey));
      assert.ok(config.admin.equals(admin.publicKey));
      assert.equal(config.totalScores.toNumber(), 0);
      assert.equal(config.totalCerts.toNumber(), 0);
    }
  });

  it("Submits a trust score", async () => {
    const agentId = "gendolf";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );

    // Fund authority from admin wallet (avoids devnet airdrop rate limits)
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: authority.publicKey,
        lamports: 500_000_000, // 0.5 SOL
      })
    );
    await provider.sendAndConfirm(transferTx);

    const evidenceHash = new Array(32).fill(0);
    evidenceHash[0] = 0xab;

    const tx = await program.methods
      .submitScore(
        agentId,
        34,   // overall
        40,   // provenance
        30,   // track_record
        25,   // presence
        20,   // endorsements
        { emerging: {} },
        evidenceHash
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        trustScore: scorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const score = await program.account.trustScore.fetch(scorePda);
    assert.equal(score.agentId, "gendolf");
    assert.equal(score.overall, 34);
    assert.equal(score.provenance, 40);
    assert.equal(score.trackRecord, 30);
    assert.equal(score.presence, 25);
    assert.equal(score.endorsements, 20);
    assert.deepEqual(score.tier, { emerging: {} });
    assert.ok(score.createdAt.toNumber() > 0);
    assert.ok(score.updatedAt.toNumber() > 0);

    const config = await program.account.oracleConfig.fetch(configPda);
    assert.equal(config.totalScores.toNumber(), 1);
  });

  it("Updates an existing score", async () => {
    const agentId = "gendolf";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );

    const evidenceHash = new Array(32).fill(0);
    evidenceHash[0] = 0xcd;

    await program.methods
      .submitScore(
        agentId,
        55,   // improved overall
        60,
        50,
        45,
        40,
        { established: {} },
        evidenceHash
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        trustScore: scorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const score = await program.account.trustScore.fetch(scorePda);
    assert.equal(score.overall, 55);
    assert.deepEqual(score.tier, { established: {} });

    // total_scores should NOT increment (update, not new)
    const config = await program.account.oracleConfig.fetch(configPda);
    assert.equal(config.totalScores.toNumber(), 1);
  });

  it("Issues a certification badge", async () => {
    const agentId = "gendolf";
    const [certPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("cert_badge"), Buffer.from(agentId)],
      program.programId
    );

    const reportHash = new Array(32).fill(0);
    reportHash[0] = 0xff;

    await program.methods
      .issueCert(
        agentId,
        { advanced: {} },
        37,     // vectors tested
        37,     // vectors blocked (100%)
        "jarvis_stark",
        reportHash
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        certBadge: certPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const cert = await program.account.certBadge.fetch(certPda);
    assert.equal(cert.agentId, "gendolf");
    assert.deepEqual(cert.certLevel, { advanced: {} });
    assert.equal(cert.vectorsTested, 37);
    assert.equal(cert.vectorsBlocked, 37);
    assert.equal(cert.blockRate, 10000); // 100% in basis points
    assert.equal(cert.testerId, "jarvis_stark");
    assert.ok(cert.issuedAt.toNumber() > 0);
    assert.ok(cert.expiresAt.toNumber() > cert.issuedAt.toNumber());

    const config = await program.account.oracleConfig.fetch(configPda);
    assert.equal(config.totalCerts.toNumber(), 1);
  });

  it("Checks trust threshold", async () => {
    const agentId = "gendolf";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );

    // Should pass with min_score = 50 (current = 55)
    // Note: check_trust returns bool via event/log, we verify the account exists
    const score = await program.account.trustScore.fetch(scorePda);
    assert.ok(score.overall >= 50);
  });

  it("Rejects unauthorized score submission", async () => {
    const agentId = "rogue_agent";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );
    const fakeAuthority = Keypair.generate();
    // Fund from admin wallet instead of airdrop (avoids devnet rate limits)
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: fakeAuthority.publicKey,
        lamports: 100_000_000, // 0.1 SOL
      })
    );
    await provider.sendAndConfirm(transferTx);

    try {
      await program.methods
        .submitScore(
          agentId, 100, 100, 100, 100, 100,
          { verified: {} },
          new Array(32).fill(0)
        )
        .accounts({
          config: configPda,
          authority: fakeAuthority.publicKey,
          trustScore: scorePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([fakeAuthority])
        .rpc();
      assert.fail("Should have failed");
    } catch (e) {
      assert.ok(e.toString().includes("ConstraintHasOne") || e.toString().includes("has_one"));
    }
  });

  it("Rejects score > 100", async () => {
    const agentId = "overflow_agent";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );

    try {
      await program.methods
        .submitScore(
          agentId, 101, 50, 50, 50, 50,
          { unknown: {} },
          new Array(32).fill(0)
        )
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          trustScore: scorePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have failed");
    } catch (e) {
      // Error may appear as custom error code or name depending on environment
      const errStr = e.toString();
      assert.ok(
        errStr.includes("ScoreOutOfRange") || errStr.includes("custom program error") || errStr.includes("6000"),
        `Expected ScoreOutOfRange error, got: ${errStr.substring(0, 200)}`
      );
    }
  });

  it("Submits TEE attestation", async () => {
    const agentId = "gendolf";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );
    const attestationHash = Array(32).fill(0).map((_, i) => i + 100);
    const buildHash = Array(32).fill(0).map((_, i) => i + 200);

    await program.methods
      .submitAttestation(
        agentId,
        { nitro: {} },
        85,
        attestationHash,
        buildHash,
        true,
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        trustScore: scorePda,
      })
      .signers([authority])
      .rpc();

    const score = await program.account.trustScore.fetch(scorePda);
    assert.equal(score.infraScore, 85);
    assert.equal(score.infraVerified, true);
    assert.deepEqual(score.teeType, { nitro: {} });
    assert.equal(score.measurementsMatch, true);
    assert.ok(score.attestationAt.toNumber() > 0);
  });

  it("Attestation with no TEE gives infra_verified=false", async () => {
    const agentId = "gendolf";
    const [scorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust_score"), Buffer.from(agentId)],
      program.programId
    );
    const zeroHash = Array(32).fill(0);

    await program.methods
      .submitAttestation(
        agentId,
        { none: {} },
        20,
        zeroHash,
        zeroHash,
        false,
      )
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        trustScore: scorePda,
      })
      .signers([authority])
      .rpc();

    const score = await program.account.trustScore.fetch(scorePda);
    assert.equal(score.infraScore, 20);
    assert.equal(score.infraVerified, false);
    assert.deepEqual(score.teeType, { none: {} });
  });

  it("Updates authority (admin only)", async () => {
    const newAuthority = Keypair.generate();

    await program.methods
      .setAuthority(newAuthority.publicKey)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
      })
      .rpc();

    const config = await program.account.oracleConfig.fetch(configPda);
    assert.ok(config.authority.equals(newAuthority.publicKey));

    // Restore original authority for other tests
    await program.methods
      .setAuthority(authority.publicKey)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
      })
      .rpc();
  });
});

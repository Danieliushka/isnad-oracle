use anchor_lang::prelude::*;

declare_id!("BhG84286N1HTG6cRmASZVNQNtFd7K98BsBrhfjYc7H31");

/// isnad Trust Oracle — On-chain trust scores for AI agents on Solana
/// 
/// Architecture:
/// - OracleConfig: singleton, stores authority (isnad backend signer)
/// - TrustScore: PDA per agent, stores multi-dimensional trust data
/// - CertBadge: PDA per agent, stores red-team certification results
/// - Any Solana program can CPI to read trust scores
#[program]
pub mod isnad_oracle {
    use super::*;

    /// Initialize the oracle config. Called once by deployer.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = authority;
        config.admin = ctx.accounts.admin.key();
        config.total_scores = 0;
        config.total_certs = 0;
        config.bump = ctx.bumps.config;
        msg!("isnad Oracle initialized. Authority: {}", authority);
        Ok(())
    }

    /// Update oracle authority (admin only)
    pub fn set_authority(ctx: Context<AdminAction>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = new_authority;
        msg!("Authority updated to: {}", new_authority);
        Ok(())
    }

    /// Submit or update a trust score for an agent.
    /// Only callable by the oracle authority (isnad backend).
    pub fn submit_score(
        ctx: Context<SubmitScore>,
        agent_id: String,        // isnad agent identifier (e.g. "gendolf", "bro-agent")
        overall: u8,             // 0-100 overall trust score
        provenance: u8,          // 0-100 provenance dimension (30% weight)
        track_record: u8,        // 0-100 track record dimension (35% weight)
        presence: u8,            // 0-100 presence dimension (20% weight)
        endorsements: u8,        // 0-100 endorsements dimension (15% weight)
        tier: TrustTier,         // UNKNOWN, EMERGING, ESTABLISHED, VERIFIED
        evidence_hash: [u8; 32], // SHA-256 of evidence chain
    ) -> Result<()> {
        require!(overall <= 100, IsnadError::ScoreOutOfRange);
        require!(provenance <= 100, IsnadError::ScoreOutOfRange);
        require!(track_record <= 100, IsnadError::ScoreOutOfRange);
        require!(presence <= 100, IsnadError::ScoreOutOfRange);
        require!(endorsements <= 100, IsnadError::ScoreOutOfRange);
        require!(agent_id.len() <= 64, IsnadError::AgentIdTooLong);

        let score = &mut ctx.accounts.trust_score;
        let is_new = score.updated_at == 0;

        score.agent_id = agent_id;
        score.overall = overall;
        score.provenance = provenance;
        score.track_record = track_record;
        score.presence = presence;
        score.endorsements = endorsements;
        score.tier = tier;
        score.evidence_hash = evidence_hash;
        score.updated_at = Clock::get()?.unix_timestamp;
        score.bump = ctx.bumps.trust_score;

        if is_new {
            score.created_at = score.updated_at;
            ctx.accounts.config.total_scores += 1;
        }

        msg!("Score updated: {} = {} ({:?})", score.agent_id, overall, tier);
        Ok(())
    }

    /// Issue or update a red-team certification badge.
    /// Records adversarial testing results on-chain.
    pub fn issue_cert(
        ctx: Context<IssueCert>,
        agent_id: String,
        cert_level: CertLevel,      // UNTESTED, BASIC, STANDARD, ADVANCED
        vectors_tested: u16,         // number of attack vectors tested
        vectors_blocked: u16,        // number successfully blocked
        tester_id: String,           // who performed the test (e.g. "jarvis_stark")
        report_hash: [u8; 32],       // SHA-256 of full report
    ) -> Result<()> {
        require!(agent_id.len() <= 64, IsnadError::AgentIdTooLong);
        require!(tester_id.len() <= 64, IsnadError::TesterIdTooLong);
        require!(vectors_blocked <= vectors_tested, IsnadError::InvalidVectorCount);

        let cert = &mut ctx.accounts.cert_badge;
        let is_new = cert.issued_at == 0;

        cert.agent_id = agent_id;
        cert.cert_level = cert_level;
        cert.vectors_tested = vectors_tested;
        cert.vectors_blocked = vectors_blocked;
        cert.block_rate = if vectors_tested > 0 {
            ((vectors_blocked as u32 * 10000) / vectors_tested as u32) as u16 // basis points
        } else {
            0
        };
        cert.tester_id = tester_id;
        cert.report_hash = report_hash;
        cert.issued_at = Clock::get()?.unix_timestamp;
        cert.expires_at = cert.issued_at + 90 * 24 * 60 * 60; // 90 days
        cert.bump = ctx.bumps.cert_badge;

        if is_new {
            ctx.accounts.config.total_certs += 1;
        }

        msg!(
            "Cert issued: {} = {:?} ({}/{} blocked, {}bps)",
            cert.agent_id, cert_level, vectors_blocked, vectors_tested, cert.block_rate
        );
        Ok(())
    }

    /// Check if an agent meets a minimum trust threshold.
    /// View function — any program can CPI this.
    pub fn check_trust(
        ctx: Context<CheckTrust>,
        _agent_id: String,
        min_score: u8,
    ) -> Result<bool> {
        let score = &ctx.accounts.trust_score;
        let meets = score.overall >= min_score;
        msg!(
            "Trust check: {} score={} min={} pass={}",
            score.agent_id, score.overall, min_score, meets
        );
        Ok(meets)
    }

    /// Submit or update TEE attestation data for an agent.
    /// Records infrastructure integrity evidence on-chain.
    pub fn submit_attestation(
        ctx: Context<SubmitAttestation>,
        agent_id: String,
        tee_type: TeeType,           // Nitro, TDX, SevSnp, None
        infra_score: u8,             // 0-100 infrastructure integrity score
        attestation_hash: [u8; 32],  // SHA-256 of full attestation quote
        build_hash: [u8; 32],        // SHA-256 of agent binary
        measurements_match: bool,    // measurements match transparency log
    ) -> Result<()> {
        require!(infra_score <= 100, IsnadError::ScoreOutOfRange);
        require!(agent_id.len() <= 64, IsnadError::AgentIdTooLong);

        let score = &mut ctx.accounts.trust_score;
        score.infra_score = infra_score;
        score.infra_verified = infra_score >= 50;
        score.attestation_hash = attestation_hash;
        score.tee_type = tee_type;
        score.build_hash = build_hash;
        score.measurements_match = measurements_match;
        score.attestation_at = Clock::get()?.unix_timestamp;

        msg!(
            "Attestation updated: {} = {} ({:?}) verified={}",
            score.agent_id, infra_score, tee_type, score.infra_verified
        );
        Ok(())
    }

    /// Check if an agent has a valid (non-expired) certification.
    pub fn check_cert(
        ctx: Context<CheckCert>,
        _agent_id: String,
    ) -> Result<bool> {
        let cert = &ctx.accounts.cert_badge;
        let now = Clock::get()?.unix_timestamp;
        let valid = cert.expires_at > now && cert.block_rate >= 9000; // 90%+ block rate
        msg!(
            "Cert check: {} level={:?} rate={}bps expires={} valid={}",
            cert.agent_id, cert.cert_level, cert.block_rate, cert.expires_at, valid
        );
        Ok(valid)
    }
}

// ==================== ACCOUNTS ====================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + OracleConfig::INIT_SPACE,
        seeds = [b"oracle_config"],
        bump
    )]
    pub config: Account<'info, OracleConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"oracle_config"],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Account<'info, OracleConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(agent_id: String)]
pub struct SubmitScore<'info> {
    #[account(
        mut,
        seeds = [b"oracle_config"],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, OracleConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + TrustScore::INIT_SPACE,
        seeds = [b"trust_score", agent_id.as_bytes()],
        bump,
    )]
    pub trust_score: Account<'info, TrustScore>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: String)]
pub struct IssueCert<'info> {
    #[account(
        mut,
        seeds = [b"oracle_config"],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, OracleConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + CertBadge::INIT_SPACE,
        seeds = [b"cert_badge", agent_id.as_bytes()],
        bump,
    )]
    pub cert_badge: Account<'info, CertBadge>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: String)]
pub struct SubmitAttestation<'info> {
    #[account(
        mut,
        seeds = [b"oracle_config"],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, OracleConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"trust_score", agent_id.as_bytes()],
        bump = trust_score.bump,
    )]
    pub trust_score: Account<'info, TrustScore>,
}

#[derive(Accounts)]
#[instruction(agent_id: String)]
pub struct CheckTrust<'info> {
    #[account(
        seeds = [b"trust_score", agent_id.as_bytes()],
        bump = trust_score.bump,
    )]
    pub trust_score: Account<'info, TrustScore>,
}

#[derive(Accounts)]
#[instruction(agent_id: String)]
pub struct CheckCert<'info> {
    #[account(
        seeds = [b"cert_badge", agent_id.as_bytes()],
        bump = cert_badge.bump,
    )]
    pub cert_badge: Account<'info, CertBadge>,
}

// ==================== STATE ====================

#[account]
#[derive(InitSpace)]
pub struct OracleConfig {
    pub authority: Pubkey,     // oracle signer (isnad backend)
    pub admin: Pubkey,         // admin who can change authority
    pub total_scores: u64,
    pub total_certs: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TrustScore {
    #[max_len(64)]
    pub agent_id: String,
    pub overall: u8,           // 0-100
    pub provenance: u8,        // 0-100 (30% weight)
    pub track_record: u8,      // 0-100 (35% weight)
    pub presence: u8,          // 0-100 (20% weight)
    pub endorsements: u8,      // 0-100 (15% weight)
    pub tier: TrustTier,
    pub evidence_hash: [u8; 32],
    pub infra_score: u8,           // 0-100 infrastructure integrity
    pub infra_verified: bool,      // true if infra_score >= 50
    pub tee_type: TeeType,         // TEE platform type
    pub attestation_hash: [u8; 32], // SHA-256 of attestation quote
    pub build_hash: [u8; 32],      // SHA-256 of agent binary
    pub measurements_match: bool,  // build matches transparency log
    pub attestation_at: i64,       // last attestation timestamp
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CertBadge {
    #[max_len(64)]
    pub agent_id: String,
    pub cert_level: CertLevel,
    pub vectors_tested: u16,
    pub vectors_blocked: u16,
    pub block_rate: u16,       // basis points (10000 = 100%)
    #[max_len(64)]
    pub tester_id: String,
    pub report_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

// ==================== ENUMS ====================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum TrustTier {
    Unknown,     // 0-24
    Emerging,    // 25-49
    Established, // 50-74
    Verified,    // 75-100
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum TeeType {
    None,     // No TEE
    Nitro,    // AWS Nitro Enclaves
    Tdx,      // Intel TDX
    SevSnp,   // AMD SEV-SNP
    Other,    // Other/Unknown TEE
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CertLevel {
    Untested,   // No testing done
    Basic,      // Tier 1: 10 vectors
    Standard,   // Tier 2: 25 vectors
    Advanced,   // Tier 3: 37+ vectors
}

// ==================== ERRORS ====================

#[error_code]
pub enum IsnadError {
    #[msg("Score must be 0-100")]
    ScoreOutOfRange,
    #[msg("Agent ID too long (max 64 chars)")]
    AgentIdTooLong,
    #[msg("Tester ID too long (max 64 chars)")]
    TesterIdTooLong,
    #[msg("Vectors blocked cannot exceed vectors tested")]
    InvalidVectorCount,
}

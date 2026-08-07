use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::vrf::{
    self,
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
};

declare_id!("5yv9aXx1vjRoCH1Ubxi7RNQggv9NHXxZC7zwUKLG4jYi");

pub const DRAW_PDA_SEED: &[u8] = b"draw";

// The only account allowed to request (or reset-and-re-request) randomness — without this,
// `giveaway_id_seed` being a public, deterministic sha256(giveaway.id) meant anyone could compute
// the right seed and call request_randomness for our exact PDA, and since that instruction
// unconditionally resets `fulfilled`/`randomness`, an outsider could grief or reset an
// already-fulfilled draw for a few cents. This can never let anyone bias WHO wins (VRF security
// holds regardless of who requests it), but it's a real griefing/audit-trail risk that has no
// reason to exist — only our own backend's fee payer ever legitimately calls this.
pub const AUTHORIZED_REQUESTER: Pubkey = pubkey!("5dCTWJj277c41ex92RFxSRUa8ckU4EAurWftDRASBKuq");

#[error_code]
pub enum ErrorCode {
    #[msg("This draw request has already been fulfilled")]
    AlreadyFulfilled,
    #[msg("Only Loofta's backend can request randomness for a draw")]
    UnauthorizedRequester,
}

#[program]
pub mod loofta_vrf {
    use super::*;

    /// Requests randomness for a giveaway's winner draw from the base-layer MagicBlock VRF
    /// oracle. `giveaway_id_seed` is sha256(giveaway.id) computed by the backend — the program
    /// never needs to know about Postgres UUIDs, only stable seed bytes. Re-callable for the
    /// same giveaway (e.g. after a manual stall-recovery retry) since a fresh, unfulfilled
    /// request just overwrites the prior one.
    pub fn request_randomness(
        ctx: Context<RequestRandomnessCtx>,
        giveaway_id_seed: [u8; 32],
        client_seed: u8,
    ) -> Result<()> {
        let draw_request = &mut ctx.accounts.draw_request;
        draw_request.fulfilled = false;
        draw_request.randomness = [0u8; 32];
        draw_request.bump = ctx.bumps.draw_request;

        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackRandomness::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: draw_request.key(),
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: Some(giveaway_id_seed.to_vec()),
            ..Default::default()
        });

        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// Invoked by the MagicBlock VRF oracle once randomness is ready. `#[vrf_callback]` injects
    /// the scoped identity signer check that proves this call genuinely came from the oracle —
    /// that check, not the seeds constraint alone, is what makes this callback trustworthy.
    pub fn callback_randomness(
        ctx: Context<CallbackRandomnessCtx>,
        randomness: [u8; 32],
        _giveaway_id_seed: [u8; 32],
    ) -> Result<()> {
        let draw_request = &mut ctx.accounts.draw_request;
        require!(!draw_request.fulfilled, ErrorCode::AlreadyFulfilled);
        draw_request.randomness = randomness;
        draw_request.fulfilled = true;
        Ok(())
    }
}

#[vrf]
#[derive(Accounts)]
#[instruction(giveaway_id_seed: [u8; 32])]
pub struct RequestRandomnessCtx<'info> {
    #[account(
        mut,
        constraint = payer.key() == AUTHORIZED_REQUESTER @ ErrorCode::UnauthorizedRequester
    )]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + DrawRequest::INIT_SPACE,
        seeds = [DRAW_PDA_SEED, giveaway_id_seed.as_ref()],
        bump
    )]
    pub draw_request: Account<'info, DrawRequest>,
    /// CHECK: validated against the known base-layer/localnet VRF oracle queue addresses.
    #[account(
        mut,
        constraint =
            oracle_queue.key() == vrf::consts::DEFAULT_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
#[instruction(randomness: [u8; 32], giveaway_id_seed: [u8; 32])]
pub struct CallbackRandomnessCtx<'info> {
    #[account(
        mut,
        seeds = [DRAW_PDA_SEED, giveaway_id_seed.as_ref()],
        bump = draw_request.bump
    )]
    pub draw_request: Account<'info, DrawRequest>,
}

#[account]
#[derive(InitSpace)]
pub struct DrawRequest {
    pub randomness: [u8; 32],
    pub fulfilled: bool,
    pub bump: u8,
}

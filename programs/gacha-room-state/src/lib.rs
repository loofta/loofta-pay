use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("45ShoiSQG8J4t1piSwsfYC38dyc9oLBbZmFr6W1KpowH");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "gacha-room-state",
    project_url: "https://loofta.xyz",
    contacts: "email:hello@loofta.xyz",
    policy: "Please report vulnerabilities responsibly by emailing hello@loofta.xyz before any public disclosure.",
    preferred_languages: "en",
    source_code: "https://github.com/loofta/gacha-room-state"
}

pub const ROOM_PDA_SEED: &[u8] = b"gacha-room";

// Same fee-payer key already public in loofta-vrf's AUTHORIZED_REQUESTER — this program shares
// the backend's one Solana fee-payer identity, it's not a new disclosure. Same rationale as that
// constant: init_room's PDA is a public, deterministic sha256(roomId), so without this any
// outsider could front-run our backend's own init call and occupy the PDA with garbage seat/
// authority data before the real room ever gets created.
pub const AUTHORIZED_INITIALIZER: Pubkey = pubkey!("5dCTWJj277c41ex92RFxSRUa8ckU4EAurWftDRASBKuq");

// Max seats any gacha_room_configs row currently allows (see gacha_room_configs.seats in
// Postgres) — the ready/vote masks are u16, giving headroom well past this; bump the mask width
// only if seats ever needs to exceed 16.
pub const MAX_SEATS: u8 = 16;

// Matches GachaService's VOTE_ROUND_MS = 30_000 exactly.
pub const VOTE_ROUND_SECONDS: i64 = 30;

pub const PHASE_WAITING: u8 = 0;
pub const PHASE_PURCHASING: u8 = 1;
pub const PHASE_OPENING: u8 = 2;
pub const PHASE_EXCLUDING: u8 = 3;
pub const PHASE_VOTING: u8 = 4;
pub const PHASE_SETTLING: u8 = 5;
pub const PHASE_SETTLED: u8 = 6;
pub const PHASE_FAILED: u8 = 7;
pub const PHASE_CANCELLED: u8 = 8;
pub const MAX_PHASE: u8 = PHASE_CANCELLED;

#[error_code]
pub enum ErrorCode {
    #[msg("Only Loofta's backend can call this instruction")]
    Unauthorized,
    #[msg("Seat count must be between 1 and MAX_SEATS")]
    InvalidSeatCount,
    #[msg("Seat number is out of range for this room")]
    SeatOutOfRange,
    #[msg("This vote round has already been finalized")]
    RoundAlreadyFinalized,
    #[msg("This seat is not a survivor eligible to vote this round")]
    NotASurvivor,
    #[msg("This vote round's deadline has already passed")]
    RoundExpired,
    #[msg("This vote round is still open — not every survivor has voted and the deadline hasn't passed yet")]
    RoundStillOpen,
    #[msg("Room phase is out of range")]
    InvalidPhase,
}

#[ephemeral]
#[program]
pub mod gacha_room_state {
    use super::*;

    /// Base-layer: creates the room's tally PDA. `room_id_seed` is sha256(gacha_rooms.id),
    /// mirroring loofta-vrf's giveaway_id_seed convention — the program never needs to know
    /// about Postgres UUIDs directly. Postgres (`gacha_rooms.status`) stays the source of truth
    /// for the room lifecycle; this account only ever holds the live ready/vote tally.
    pub fn init_room(ctx: Context<InitRoom>, room_id_seed: [u8; 32], seats: u8) -> Result<()> {
        require!(seats > 0 && seats <= MAX_SEATS, ErrorCode::InvalidSeatCount);
        let room = &mut ctx.accounts.room;
        room.room_id_seed = room_id_seed;
        room.authority = ctx.accounts.payer.key();
        room.seats = seats;
        room.ready_mask = 0;
        room.vote_round = 0;
        room.survivor_mask = 0;
        room.voted_mask = 0;
        room.yes_mask = 0;
        room.round_started_at = 0;
        room.round_deadline = 0;
        room.finalized = false;
        room.bump = ctx.bumps.room;
        room.phase = PHASE_WAITING;
        room.excluded_mask = 0;
        room.last_cut_round = 0;
        room.last_cut_seat = 0;
        room.settled = false;
        Ok(())
    }

    /// Base-layer: hands the room's tally PDA to the ephemeral rollup so subsequent
    /// mark_ready/cast_vote calls run there instead of on base layer.
    pub fn delegate_room(ctx: Context<DelegateRoom>, room_id_seed: [u8; 32]) -> Result<()> {
        ctx.accounts.delegate_room(
            &ctx.accounts.payer,
            &[ROOM_PDA_SEED, room_id_seed.as_ref()],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Ephemeral rollup: marks a seat ready. Idempotent — marking the same seat twice is a no-op,
    /// not an error, since a client retry after a dropped ack shouldn't fail.
    pub fn mark_ready(ctx: Context<AuthorityWrite>, seat_number: u8) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(
            seat_number > 0 && seat_number <= room.seats,
            ErrorCode::SeatOutOfRange
        );
        room.ready_mask |= 1u16 << (seat_number - 1);
        Ok(())
    }

    /// Ephemeral rollup: records the compact game phase clients can subscribe to. The database
    /// still owns business workflow and heavy metadata; this byte is the real-time gameplay cue.
    pub fn set_phase(ctx: Context<AuthorityWrite>, phase: u8) -> Result<()> {
        require!(phase <= MAX_PHASE, ErrorCode::InvalidPhase);
        let room = &mut ctx.accounts.room;
        room.phase = phase;
        room.settled = phase == PHASE_SETTLED;
        Ok(())
    }

    /// Ephemeral rollup: records the initial exclusion draw result as a mask so late/subscribed
    /// clients don't need a custom socket event to know which seats were cut before voting.
    pub fn record_initial_exclusion(
        ctx: Context<AuthorityWrite>,
        excluded_mask: u16,
    ) -> Result<()> {
        let room = &mut ctx.accounts.room;
        room.excluded_mask = excluded_mask;
        room.phase = PHASE_VOTING;
        Ok(())
    }

    /// Ephemeral rollup: starts (or restarts, for the next round) a "cut one more?" vote —
    /// mirrors GachaService.startVoteRound. `survivor_mask` is computed off-chain from Postgres
    /// (gacha_room_participants.excluded) and passed in fresh each round, same as today's JS
    /// version reads survivors from the DB each time rather than deriving them on-chain.
    pub fn start_vote_round(
        ctx: Context<AuthorityWrite>,
        round: u16,
        survivor_mask: u16,
    ) -> Result<()> {
        let room = &mut ctx.accounts.room;
        room.vote_round = round;
        room.survivor_mask = survivor_mask;
        room.voted_mask = 0;
        room.yes_mask = 0;
        room.finalized = false;
        let now = Clock::get()?.unix_timestamp;
        room.round_started_at = now;
        room.round_deadline = now + VOTE_ROUND_SECONDS;
        room.phase = PHASE_VOTING;
        Ok(())
    }

    /// Ephemeral rollup: casts (or changes) one seat's vote for the current round. This is the
    /// direct fix for the race `withVoteLock` used to patch in gacha.service.ts — two cast_vote
    /// transactions against the same PDA can't interleave the way two `await`ed JS calls against
    /// a shared Map could, so the mutex this replaces is no longer needed at all.
    pub fn cast_vote(ctx: Context<AuthorityWrite>, seat_number: u8, vote: bool) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(!room.finalized, ErrorCode::RoundAlreadyFinalized);
        require!(
            seat_number > 0 && seat_number <= room.seats,
            ErrorCode::SeatOutOfRange
        );
        let bit = 1u16 << (seat_number - 1);
        require!(room.survivor_mask & bit != 0, ErrorCode::NotASurvivor);
        let now = Clock::get()?.unix_timestamp;
        require!(now <= room.round_deadline, ErrorCode::RoundExpired);
        room.voted_mask |= bit;
        if vote {
            room.yes_mask |= bit;
        } else {
            room.yes_mask &= !bit;
        }
        Ok(())
    }

    /// Ephemeral rollup: closes out the current round once either every survivor has voted or the
    /// 30s deadline has passed (whichever first) — replaces the cron's maybeTimeoutVoteRound
    /// entirely; there's no separate "auto-vote NO for stragglers" write needed, since the tally
    /// below counts against survivor_mask (everyone who COULD have voted), not voted_mask (who
    /// actually did) — a straggler's bit simply never got set in yes_mask, which already reads as
    /// NO. Idempotent: finalizing an already-finalized round is a no-op, not an error, so a retry
    /// after a dropped ack (or the cron and a client racing to finalize) is harmless.
    pub fn finalize_vote_round(ctx: Context<AuthorityWrite>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        if room.finalized {
            return Ok(());
        }
        let now = Clock::get()?.unix_timestamp;
        let all_voted = room.voted_mask == room.survivor_mask;
        require!(
            all_voted || now > room.round_deadline,
            ErrorCode::RoundStillOpen
        );
        room.finalized = true;
        Ok(())
    }

    /// Ephemeral rollup: records the seat cut by a passed vote round. This keeps the cut animation
    /// and survivor state subscribable from ER while Postgres remains the durable payout source.
    pub fn record_vote_cut(
        ctx: Context<AuthorityWrite>,
        round: u16,
        seat_number: u8,
    ) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(
            seat_number > 0 && seat_number <= room.seats,
            ErrorCode::SeatOutOfRange
        );
        let bit = 1u16 << (seat_number - 1);
        room.excluded_mask |= bit;
        room.last_cut_round = round;
        room.last_cut_seat = seat_number;
        Ok(())
    }

    /// Ephemeral rollup only: commits the current tally back to base layer without ending the ER
    /// session — not yet wired to a call site (Phase 1 doesn't
    /// need mid-session commits, see the plan doc's commit-sponsorship note), included now so the
    /// account/program shape doesn't need to change when a future phase does need it.
    pub fn commit_room(ctx: Context<CommitRoom>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.room.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Ephemeral rollup: commits the final tally and hands the PDA back to base-layer ownership.
    /// Called once per room, at settlement (see gacha.service.ts's finalizeBuybackSettlement) —
    /// this PDA holds no funds, so closing/rent-reclaim happens as a separate, ordinary base-layer
    /// close once ownership is back, not as part of this instruction.
    pub fn undelegate_room(ctx: Context<CommitRoom>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.room.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(room_id_seed: [u8; 32], seats: u8)]
pub struct InitRoom<'info> {
    #[account(
        mut,
        constraint = payer.key() == AUTHORIZED_INITIALIZER @ ErrorCode::Unauthorized
    )]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + GachaRoomState::INIT_SPACE,
        seeds = [ROOM_PDA_SEED, room_id_seed.as_ref()],
        bump
    )]
    pub room: Account<'info, GachaRoomState>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(room_id_seed: [u8; 32])]
pub struct DelegateRoom<'info> {
    #[account(mut, constraint = payer.key() == AUTHORIZED_INITIALIZER @ ErrorCode::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: the room PDA being delegated — validated by the seeds/del constraint below.
    #[account(mut, del, seeds = [ROOM_PDA_SEED, room_id_seed.as_ref()], bump)]
    pub room: AccountInfo<'info>,
}

// Shared by mark_ready/start_vote_round/cast_vote/finalize_vote_round — all four take exactly
// this shape (the already-delegated room account + the backend's authority signature), so one
// context type covers all of them rather than four structurally-identical duplicates.
#[derive(Accounts)]
pub struct AuthorityWrite<'info> {
    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub room: Account<'info, GachaRoomState>,
    pub authority: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitRoom<'info> {
    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub room: Account<'info, GachaRoomState>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct GachaRoomState {
    pub room_id_seed: [u8; 32],
    pub authority: Pubkey,
    pub seats: u8,
    pub ready_mask: u16,
    pub vote_round: u16,
    pub survivor_mask: u16,
    pub voted_mask: u16,
    pub yes_mask: u16,
    pub round_started_at: i64,
    pub round_deadline: i64,
    pub finalized: bool,
    pub bump: u8,
    pub phase: u8,
    pub excluded_mask: u16,
    pub last_cut_round: u16,
    pub last_cut_seat: u8,
    pub settled: bool,
}

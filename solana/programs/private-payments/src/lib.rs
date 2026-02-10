use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::access_control::instructions::CreatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::{AUTHORITY_FLAG, Member, MembersArgs};
use session_keys::{SessionError, SessionToken, session_auth_or, Session};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub const DEPOSIT_PDA_SEED: &[u8] = b"deposit";
pub const VAULT_PDA_SEED: &[u8] = b"vault";
pub const CONFIG_PDA_SEED: &[u8] = b"config";
pub const PAYMENT_REQUEST_SEED: &[u8] = b"payment_request";
/// Audit log: platform-only readable on PER for compliance (payer ↔ recipient link).
pub const AUDIT_LOG_SEED: &[u8] = b"audit_log";

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid platform authority")]
    InvalidPlatformAuthority,
    #[msg("Payment request not open")]
    PaymentRequestNotOpen,
    #[msg("Payment request amount mismatch")]
    PaymentRequestAmountMismatch,
}

#[ephemeral]
#[program]
pub mod private_payments {
    use anchor_spl::token::{transfer_checked, TransferChecked};

    use super::*;

    pub fn initialize_deposit(ctx: Context<InitializeDeposit>) -> Result<()> {
        let deposit = &mut ctx.accounts.deposit;
        deposit.set_inner(Deposit {
            user: ctx.accounts.user.key(),
            token_mint: ctx.accounts.token_mint.key(),
            amount: 0,
        });
        Ok(())
    }

    pub fn modify_balance(ctx: Context<ModifyDeposit>, args: ModifyDepositArgs) -> Result<()> {
        let deposit = &mut ctx.accounts.deposit;
        if args.increase {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_token_account.to_account_info(),
                        mint: ctx.accounts.token_mint.to_account_info(),
                        to: ctx.accounts.vault_token_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                args.amount,
                ctx.accounts.token_mint.decimals,
            )?;
            deposit.amount += args.amount;
        } else {
            let seeds = [
                VAULT_PDA_SEED,
                &ctx.accounts.token_mint.key().to_bytes(),
                &[ctx.bumps.vault],
            ];
            let signer_seeds = &[&seeds[..]];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault_token_account.to_account_info(),
                        mint: ctx.accounts.token_mint.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                args.amount,
                ctx.accounts.token_mint.decimals,
            )?;
            deposit.amount -= args.amount;
        }
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.source_deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn transfer_deposit(ctx: Context<TransferDeposit>, amount: u64) -> Result<()> {
        let source_deposit = &mut ctx.accounts.source_deposit;
        let destination_deposit = &mut ctx.accounts.destination_deposit;
        source_deposit.amount -= amount;
        destination_deposit.amount += amount;
        Ok(())
    }

    pub fn create_permission(ctx: Context<CreatePermission>) -> Result<()> {
        let members = vec![Member {
            pubkey: ctx.accounts.user.key(),
            flags: AUTHORITY_FLAG,
        }];
        CreatePermissionCpiBuilder::new(ctx.accounts.permission_program.as_ref())
            .permission(&ctx.accounts.permission)
            .permissioned_account(&ctx.accounts.deposit.to_account_info())
            .payer(&ctx.accounts.payer)
            .system_program(ctx.accounts.system_program.as_ref())
            .args(MembersArgs {
                members: Some(members),
            })
            .invoke_signed(&[&[
                DEPOSIT_PDA_SEED,
                ctx.accounts.user.key().as_ref(),
                ctx.accounts.deposit.token_mint.as_ref(),
                &[ctx.bumps.deposit],
            ]])?;
        Ok(())
    }

    pub fn delegate(ctx: Context<DelegateDeposit>, user: Pubkey, token_mint: Pubkey) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_deposit(
            &ctx.accounts.payer,
            &[DEPOSIT_PDA_SEED, user.as_ref(), token_mint.as_ref()],
            DelegateConfig {
                validator,
                commit_frequency_ms: 0,
            },
        )?;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn undelegate(ctx: Context<UndelegateDeposit>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.deposit.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// One-time init: set platform authority (backend keypair) for pay_with_authorization / pay_request / log_audit.
    pub fn initialize_config(ctx: Context<InitializeConfig>, platform_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.platform_authority = platform_authority;
        Ok(())
    }

    /// Create payment request (recipient + amount + mint). Backend maps username/email → recipient wallet.
    pub fn create_payment_request(
        ctx: Context<CreatePaymentRequest>,
        amount: u64,
        nonce: u64,
    ) -> Result<()> {
        let req = &mut ctx.accounts.payment_request;
        req.recipient = ctx.accounts.recipient.key();
        req.amount = amount;
        req.token_mint = ctx.accounts.token_mint.key();
        req.status = PaymentRequestStatus::Open;
        req.nonce = nonce;
        req.bump = ctx.bumps.payment_request;
        Ok(())
    }

    /// Private transfer: platform must sign. Payer only sees destination_deposit PDA; recipient hidden. Run on PER.
    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.source_deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn pay_with_authorization(ctx: Context<PayWithAuthorization>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.platform_authority.is_signer,
            ErrorCode::InvalidPlatformAuthority
        );
        require!(
            ctx.accounts.platform_authority.key() == ctx.accounts.config.platform_authority,
            ErrorCode::InvalidPlatformAuthority
        );
        let source_deposit = &mut ctx.accounts.source_deposit;
        let destination_deposit = &mut ctx.accounts.destination_deposit;
        source_deposit.amount -= amount;
        destination_deposit.amount += amount;
        Ok(())
    }

    /// Fulfill payment request on PER. Platform must sign.
    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.source_deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn pay_request(ctx: Context<PayRequest>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.platform_authority.is_signer,
            ErrorCode::InvalidPlatformAuthority
        );
        require!(
            ctx.accounts.platform_authority.key() == ctx.accounts.config.platform_authority,
            ErrorCode::InvalidPlatformAuthority
        );
        let req = &ctx.accounts.payment_request;
        require!(
            req.status == PaymentRequestStatus::Open,
            ErrorCode::PaymentRequestNotOpen
        );
        require!(req.amount == amount, ErrorCode::PaymentRequestAmountMismatch);
        let source_deposit = &mut ctx.accounts.source_deposit;
        let destination_deposit = &mut ctx.accounts.destination_deposit;
        source_deposit.amount -= amount;
        destination_deposit.amount += amount;
        let req_mut = &mut ctx.accounts.payment_request;
        req_mut.status = PaymentRequestStatus::Fulfilled;
        Ok(())
    }

    /// Program-side audit: record payer ↔ recipient link. Only platform_authority can call.
    /// Delegate the audit account to PER and add only platform to its permission group so only "us" can read.
    pub fn log_audit(
        ctx: Context<LogAudit>,
        payment_id: [u8; 32],
        payer: Pubkey,
        recipient: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.platform_authority.is_signer
                && ctx.accounts.platform_authority.key() == ctx.accounts.config.platform_authority,
            ErrorCode::InvalidPlatformAuthority
        );
        let audit = &mut ctx.accounts.audit_log;
        audit.payment_id = payment_id;
        audit.payer = payer;
        audit.recipient = recipient;
        audit.amount = amount;
        audit.token_mint = ctx.accounts.token_mint.key();
        audit.timestamp = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Anyone can initialize
    pub user: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Deposit::INIT_SPACE,
        seeds = [DEPOSIT_PDA_SEED, user.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub deposit: Account<'info, Deposit>,
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ModifyDepositArgs {
    pub amount: u64,
    pub increase: bool,
}

#[derive(Accounts)]
pub struct ModifyDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_PDA_SEED, deposit.token_mint.as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, deposit.user.as_ref(), deposit.token_mint.as_ref()],
        bump,
        has_one = user,
        has_one = token_mint,
    )]
    pub deposit: Account<'info, Deposit>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct TransferDeposit<'info> {
    /// CHECK: Payer identity
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(signer = payer, authority = user.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, source_deposit.user.as_ref(), source_deposit.token_mint.as_ref()],
        bump,
        has_one = user,
        has_one = token_mint,
        constraint = source_deposit.user != destination_deposit.user,
    )]
    pub source_deposit: Account<'info, Deposit>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, destination_deposit.user.as_ref(), destination_deposit.token_mint.as_ref()],
        bump,
        has_one = token_mint,
    )]
    pub destination_deposit: Account<'info, Deposit>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Anyone
    pub user: UncheckedAccount<'info>,
    #[account(
        seeds = [DEPOSIT_PDA_SEED, user.key().as_ref(), deposit.token_mint.as_ref()],
        bump
    )]
    pub deposit: Account<'info, Deposit>,
    /// CHECK: Permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission program
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(user: Pubkey, token_mint: Pubkey)]
pub struct DelegateDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Delegate program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: Validated by seeds and bump; account is closed (del) by this instruction.
    #[account(
        mut,
        del,
        seeds = [DEPOSIT_PDA_SEED, user.as_ref(), token_mint.as_ref()],
        bump,
    )]
    pub deposit: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts, Session)]
pub struct UndelegateDeposit<'info> {
    /// CHECK: User identity
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(signer = payer, authority = user.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, user.key().as_ref(), deposit.token_mint.as_ref()],
        bump
    )]
    pub deposit: Account<'info, Deposit>,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_PDA_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreatePaymentRequest<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Recipient wallet (e.g. embedded; backend maps username → this)
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + PaymentRequest::INIT_SPACE,
        seeds = [PAYMENT_REQUEST_SEED, recipient.key().as_ref(), token_mint.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub payment_request: Account<'info, PaymentRequest>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct PayWithAuthorization<'info> {
    /// CHECK: Payer identity
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(signer = payer, authority = user.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, source_deposit.user.as_ref(), source_deposit.token_mint.as_ref()],
        bump,
        has_one = user,
        has_one = token_mint,
        constraint = source_deposit.user != destination_deposit.user,
    )]
    pub source_deposit: Account<'info, Deposit>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, destination_deposit.user.as_ref(), destination_deposit.token_mint.as_ref()],
        bump,
        has_one = token_mint,
    )]
    pub destination_deposit: Account<'info, Deposit>,
    pub token_mint: Account<'info, Mint>,
    pub platform_authority: Signer<'info>,
    #[account(seeds = [CONFIG_PDA_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct PayRequest<'info> {
    /// CHECK: Payer identity
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(signer = payer, authority = user.key())]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, source_deposit.user.as_ref(), source_deposit.token_mint.as_ref()],
        bump,
        has_one = user,
        has_one = token_mint,
    )]
    pub source_deposit: Account<'info, Deposit>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, payment_request.recipient.as_ref(), payment_request.token_mint.as_ref()],
        bump,
        constraint = source_deposit.user != destination_deposit.user,
    )]
    pub destination_deposit: Account<'info, Deposit>,
    #[account(
        mut,
        seeds = [PAYMENT_REQUEST_SEED, payment_request.recipient.as_ref(), payment_request.token_mint.as_ref(), &payment_request.nonce.to_le_bytes()],
        bump = payment_request.bump,
    )]
    pub payment_request: Account<'info, PaymentRequest>,
    pub token_mint: Account<'info, Mint>,
    pub platform_authority: Signer<'info>,
    #[account(seeds = [CONFIG_PDA_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct LogAudit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub platform_authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + AuditLog::INIT_SPACE,
        seeds = [AUDIT_LOG_SEED, &payment_id],
        bump
    )]
    pub audit_log: Account<'info, AuditLog>,
    pub token_mint: Account<'info, Mint>,
    #[account(seeds = [CONFIG_PDA_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Deposit {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub _dummy: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub platform_authority: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum PaymentRequestStatus {
    Open = 0,
    Fulfilled = 1,
    Cancelled = 2,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentRequest {
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub status: PaymentRequestStatus,
    pub nonce: u64,
    pub bump: u8,
}

/// Platform-only readable on PER (via permission group) for compliance.
#[account]
#[derive(InitSpace)]
pub struct AuditLog {
    pub payment_id: [u8; 32],
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub timestamp: i64,
}

//! Payroll Attestation — small NEAR contract for on-chain payment attestation.
//! One record per claim_id; stores only a commitment hash (no plaintext amount/token/recipient).
//! Build with: cargo near build (deploy the WASM from target/near/..., not target/wasm32-unknown-unknown/release).
//!
//! Privacy: on-chain we store claim_id, execution_ref, commitment (SHA256 preimage), timestamp.
//! Preimage for commitment (canonical, built off-chain): claim_id + "\n" + execution_ref + "\n"
//! + amount + "\n" + token_symbol + "\n" + token_chain + "\n" + (recipient_id or "") + "\n" + nonce_hex.
//! Verification: recompute hash from off-chain data + stored nonce; must equal on-chain commitment.

use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};
use near_sdk::env;
use near_sdk::near;
use near_sdk::serde::Serialize;
use schemars::JsonSchema;

/// 32-byte commitment (e.g. SHA256 of canonical preimage). No plaintext amount/token/recipient on-chain.
#[derive(BorshDeserialize, BorshSerialize, BorshSchema, Serialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentAttestation {
    pub claim_id: String,
    pub execution_ref: String,
    /// SHA256(claim_id || "\n" || execution_ref || "\n" || amount || "\n" || token_symbol || "\n" || token_chain || "\n" || recipient_or_empty || "\n" || nonce_hex)
    pub commitment: [u8; 32],
    pub timestamp_nanos: u64,
}

#[near(contract_state)]
#[derive(Default)]
pub struct PayrollAttestation {
    owner_id: String,
    /// Only this account (or empty = any) can call record_payment.
    allowed_caller: Option<String>,
    payments: std::collections::HashMap<String, PaymentAttestation>,
}

#[near]
impl PayrollAttestation {
    /// Initialize. Pass allowed_caller as a string (backend account ID); empty string = any caller.
    #[init]
    pub fn new(allowed_caller: String) -> Self {
        let owner_id = env::predecessor_account_id().to_string();
        let allowed_caller = if allowed_caller.is_empty() {
            None
        } else {
            Some(allowed_caller)
        };
        Self {
            owner_id,
            allowed_caller,
            payments: std::collections::HashMap::new(),
        }
    }

    /// Record a payment attestation. Idempotent by claim_id. Only commitment is stored (no plaintext amount/token/recipient).
    /// Commitment must be SHA256 of canonical preimage (see PRIVACY.md / module docs).
    #[payable]
    pub fn record_payment(
        &mut self,
        claim_id: String,
        execution_ref: String,
        commitment: Vec<u8>,
    ) {
        if let Some(ref allowed) = self.allowed_caller {
            let caller = env::predecessor_account_id().to_string();
            assert_eq!(caller, *allowed, "Only the allowed caller can record payments");
        }
        assert_eq!(
            commitment.len(),
            32,
            "commitment must be 32 bytes (e.g. SHA256)"
        );
        assert!(
            !self.payments.contains_key(&claim_id),
            "Attestation for this claim_id already exists"
        );
        let commitment_arr: [u8; 32] = commitment
            .try_into()
            .expect("commitment len already checked");
        let timestamp_nanos = env::block_timestamp();
        self.payments.insert(
            claim_id.clone(),
            PaymentAttestation {
                claim_id,
                execution_ref,
                commitment: commitment_arr,
                timestamp_nanos,
            },
        );
    }

    pub fn get_payment(&self, claim_id: String) -> Option<PaymentAttestation> {
        self.payments.get(&claim_id).cloned()
    }

    pub fn set_allowed_caller(&mut self, account_id: Option<String>) {
        assert_eq!(
            env::predecessor_account_id().to_string(),
            self.owner_id,
            "Only owner can set allowed caller"
        );
        self.allowed_caller = account_id;
    }
}

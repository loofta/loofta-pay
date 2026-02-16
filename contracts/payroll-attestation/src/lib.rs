//! Payroll Attestation — small NEAR contract for on-chain payment attestation.
//! One record per claim_id: claim_id, amount, token, execution_ref (idempotent).
//! Build with: cargo near build (deploy the WASM from target/near/..., not target/wasm32-unknown-unknown/release).
//!
//! Design notes:
//! - Key by claim_id: backend and DB are claim-centric (one claim → one payment → one attestation).
//!   Invoice is a separate concept (deal_invoices); if needed later, add optional invoice_id field.
//! - Privacy: all fields are public on-chain. For payroll, amounts and recipient are sensitive.
//!   See PRIVACY.md in this crate for future options (hash-only, ZK, off-chain signed + on-chain anchor).

use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};
use near_sdk::env;
use near_sdk::near;
use near_sdk::serde::Serialize;
use schemars::JsonSchema;

#[derive(BorshDeserialize, BorshSerialize, BorshSchema, Serialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentAttestation {
    pub claim_id: String,
    pub amount: String,
    pub token_symbol: String,
    pub token_chain: String,
    pub execution_ref: String,
    pub recipient_id: Option<String>,
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

    /// Record a payment attestation. Idempotent by claim_id: one record per claim.
    #[payable]
    pub fn record_payment(
        &mut self,
        claim_id: String,
        amount: String,
        token_symbol: String,
        token_chain: String,
        execution_ref: String,
        recipient_id: Option<String>,
    ) {
        if let Some(ref allowed) = self.allowed_caller {
            let caller = env::predecessor_account_id().to_string();
            assert_eq!(caller, *allowed, "Only the allowed caller can record payments");
        }
        assert!(
            !self.payments.contains_key(&claim_id),
            "Attestation for this claim_id already exists"
        );
        let timestamp_nanos = env::block_timestamp();
        self.payments.insert(
            claim_id.clone(),
            PaymentAttestation {
                claim_id,
                amount,
                token_symbol,
                token_chain,
                execution_ref,
                recipient_id,
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

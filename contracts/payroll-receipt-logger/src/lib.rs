//! Payroll Receipt Logger — tiny NEAR contract for on-chain audit.
//! Stores only hashes (batch_hash, tx_refs_hash). No amounts on-chain.
//! Prevents double-pay via nonce per authorizer.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::env;
use near_sdk::near_bindgen;
use near_sdk::serde::Serialize;
use std::collections::HashMap;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Receipt {
    pub payroll_id: String,
    /// Commitment to the batch (hash only — no amounts on-chain).
    pub batch_hash: String,
    /// Who authorized this payroll (e.g. employer account id).
    pub authorizer_id: String,
    /// Nonce used for this receipt (idempotency).
    pub nonce: u64,
    /// Executor/solver that performed the payouts.
    pub executor_id: String,
    /// success | partial | failed
    pub status: String,
    /// Hash of tx refs (no raw tx ids on-chain if you want extra privacy).
    pub tx_refs_hash: String,
    pub timestamp_nanos: u64,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct PayrollReceiptLogger {
    /// Deployer = only one who can set allowed_caller.
    owner_id: String,
    /// payroll_id -> Receipt (one receipt per payroll).
    receipts: HashMap<String, Receipt>,
    /// (authorizer_id, nonce) -> () to prevent double-use of nonce.
    used_nonces: HashMap<(String, u64), ()>,
    /// Only this account (or None = any) can call record_receipt.
    allowed_caller: Option<String>,
}

impl Default for PayrollReceiptLogger {
    fn default() -> Self {
        Self {
            owner_id: String::new(),
            receipts: HashMap::new(),
            used_nonces: HashMap::new(),
            allowed_caller: None,
        }
    }
}

#[near_bindgen]
impl PayrollReceiptLogger {
    #[init]
    pub fn new(allowed_caller: Option<String>) -> Self {
        let owner_id = env::predecessor_account_id().as_str().to_string();
        Self {
            owner_id,
            receipts: HashMap::new(),
            used_nonces: HashMap::new(),
            allowed_caller,
        }
    }

    /// Record a payroll receipt. Only hashes are stored — no amounts.
    /// Fails if payroll_id already has a receipt or if (authorizer_id, nonce) was already used.
    #[payable]
    pub fn record_receipt(
        &mut self,
        payroll_id: String,
        batch_hash: String,
        authorizer_id: String,
        nonce: u64,
        executor_id: String,
        status: String,
        tx_refs_hash: String,
    ) {
        if let Some(ref allowed) = self.allowed_caller {
            let caller = env::predecessor_account_id().as_str().to_string();
            assert_eq!(
                caller, *allowed,
                "Only the allowed caller can record receipts"
            );
        }

        assert!(
            !self.receipts.contains_key(&payroll_id),
            "Receipt for this payroll_id already exists"
        );

        let key = (authorizer_id.clone(), nonce);
        assert!(
            !self.used_nonces.contains_key(&key),
            "This nonce was already used for this authorizer"
        );

        let timestamp_nanos = env::block_timestamp();
        self.receipts.insert(
            payroll_id.clone(),
            Receipt {
                payroll_id,
                batch_hash,
                authorizer_id: key.0,
                nonce: key.1,
                executor_id,
                status,
                tx_refs_hash,
                timestamp_nanos,
            },
        );
        self.used_nonces.insert(key, ());
    }

    /// Get receipt by payroll_id.
    pub fn get_receipt(&self, payroll_id: String) -> Option<Receipt> {
        self.receipts.get(&payroll_id).cloned()
    }

    /// Check if a nonce was already used for an authorizer.
    pub fn is_nonce_used(&self, authorizer_id: String, nonce: u64) -> bool {
        self.used_nonces
            .contains_key(&(authorizer_id, nonce))
    }

    /// Set allowed caller. Only contract owner (deployer) can call.
    pub fn set_allowed_caller(&mut self, account_id: Option<String>) {
        assert_eq!(
            env::predecessor_account_id().as_str(),
            self.owner_id.as_str(),
            "Only owner can set allowed caller"
        );
        self.allowed_caller = account_id;
    }
}

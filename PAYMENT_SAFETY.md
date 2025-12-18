# Payment Processing Safety Mechanisms

## Overview
This document outlines the safety mechanisms in place to prevent double processing of payments, race conditions, and ensure idempotency.

## Current Safety Mechanisms

### 1. **Distributed Locks** ✅
- **Implementation**: Redis SET with NX (only if not exists) and EX (expiry)
- **Location**: `/src/lib/redis-lock.ts`
- **Purpose**: Prevents multiple cron instances from processing the same payment simultaneously
- **Lock Duration**: 5 minutes (300 seconds)
- **Lock Key Format**: `lock:payment:<redisKey>` or `lock:swap:<claimId>`

### 2. **Status Checks** ✅
- **Before Processing**: Check if status is already `completed` or `failed`
- **After Lock**: Re-read data to verify another instance didn't process it
- **Status States**:
  - Lottery: `pending` → `executed` / `refunded` / `failed`
  - Swaps: `pending_deposit` → `funded` → `swapping` → `completed` / `failed`
  - Claims: `pending_first_deposit` → `first_received` → `second_sent` → `completed` / `failed`

### 3. **Idempotency Checks** ✅
- **Transaction Hash Verification**: Before processing, check if a transaction hash already exists
- **Payment Logs**: Check existing payment logs to see if already executed/refunded
- **Prevents**: Re-processing if transaction was successful but status update failed

### 4. **Atomic Operations** ⚠️ (Partially Implemented)
- **Issue**: Status updates and pending set removal are separate operations
- **Risk**: Small window where status could be updated but item not removed from pending set
- **Mitigation**: Distributed locks reduce this risk significantly

### 5. **Pending Set Management** ✅
- **Removal**: Items removed from pending set only after successful processing
- **Double-Check**: Verify item still in pending set after acquiring lock
- **Cleanup**: Failed/expired items are removed from pending set

## Remaining Risks & Recommendations

### ⚠️ **Risk 1: Transaction Hash Not Recorded**
**Scenario**: Transaction succeeds but Redis update fails
**Impact**: Could be retried, but idempotency check should catch this
**Mitigation**: ✅ Idempotency checks in place

### ⚠️ **Risk 2: Multiple Cron Instances**
**Scenario**: Vercel spawns multiple cron instances simultaneously
**Impact**: Both try to process same payment
**Mitigation**: ✅ Distributed locks prevent this

### ⚠️ **Risk 3: Lock Expiry During Long Transaction**
**Scenario**: Transaction takes > 5 minutes, lock expires
**Impact**: Another instance could start processing
**Mitigation**: ⚠️ Consider increasing lock duration or implementing lock renewal

### ⚠️ **Risk 4: Redis Failure**
**Scenario**: Redis goes down during processing
**Impact**: Status updates lost, could retry
**Mitigation**: ⚠️ Transaction hashes stored in Supabase provide backup

## Recommendations

1. **✅ IMPLEMENTED**: Distributed locks
2. **✅ IMPLEMENTED**: Idempotency checks
3. **⚠️ TODO**: Add transaction hash verification before processing
4. **⚠️ TODO**: Implement lock renewal for long-running transactions
5. **⚠️ TODO**: Add Supabase transaction log as backup to Redis
6. **⚠️ TODO**: Add monitoring/alerts for duplicate processing attempts

## Testing Checklist

- [ ] Test concurrent cron execution (should only process once)
- [ ] Test idempotency (re-run cron on already-processed payment)
- [ ] Test lock expiry during long transaction
- [ ] Test Redis failure scenario
- [ ] Test status update failure after successful transaction

## Current Implementation Status

| Feature | Lottery | Swaps | Claims |
|---------|---------|-------|--------|
| Distributed Locks | ✅ | ✅ | ✅ |
| Idempotency Checks | ✅ | ✅ | ✅ |
| Status Verification | ✅ | ✅ | ✅ |
| Atomic Operations | ⚠️ | ⚠️ | ⚠️ |

**Legend**:
- ✅ Fully implemented
- ⚠️ Partially implemented (needs improvement)
- ❌ Not implemented


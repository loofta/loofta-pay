import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTweet, parseReplyPay, parseTicketGift } from './parser'

test('explicit command still parses', () => {
  const r = parseTweet('@looftapay send $5 to @alice', 'maria')
  assert.deepEqual(r, { senderHandle: 'maria', recipientHandle: 'alice', amountUsd: 5 })
})

test('reply-to-pay pays the parent author', () => {
  const r = parseReplyPay('@looftapay pay $5', 'Maria', 'Alice')
  assert.deepEqual(r, { senderHandle: 'maria', recipientHandle: 'alice', amountUsd: 5 })
})

test('reply-to-pay accepts tip, decimals, usdc and a trailing period', () => {
  assert.equal(parseReplyPay('@looftapay tip 2.50 usdc', 'm', 'a')?.amountUsd, 2.5)
  assert.equal(parseReplyPay('@looftapay pay $5.', 'm', 'a')?.amountUsd, 5)
  assert.equal(parseReplyPay('@alice @looftapay pay $12 great thread', 'm', 'alice2')?.amountUsd, 12)
})

test('reply-to-pay needs a parent', () => {
  assert.equal(parseReplyPay('@looftapay pay $5', 'm', null), null)
})

test('reply-to-pay does not steal explicit or ticket commands', () => {
  assert.equal(parseReplyPay('@looftapay pay $5 to @bob', 'm', 'a'), null)
  assert.equal(parseReplyPay('@looftapay send 3 tickets', 'm', 'a'), null)
  assert.equal(parseReplyPay('@looftapay pay 10 tickets to @bob', 'm', 'a'), null)
  assert.ok(parseTicketGift('@looftapay gift 3 tickets to @bob', 'm'))
})

test('reply-to-pay ignores informational tweets and self/bot targets', () => {
  assert.equal(parseReplyPay('I used @looftapay to pay $5', 'm', 'a'), null)
  assert.equal(parseReplyPay('@looftapay pay $5', 'm', 'm'), null)
  assert.equal(parseReplyPay('@looftapay pay $5', 'm', 'looftapay'), null)
})

test('reply-to-pay enforces amount bounds', () => {
  assert.equal(parseReplyPay('@looftapay pay $0', 'm', 'a'), null)
  assert.equal(parseReplyPay('@looftapay pay $10001', 'm', 'a'), null)
})

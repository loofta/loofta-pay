jest.mock('@/modules/telegram-bot/telegram-api', () => ({
  escapeHtml: (s: string) => s,
  TelegramApi: class { sendMessage = jest.fn().mockResolvedValue({ message_id: 501 }); },
}));

import { parseSupportJson, sanitizeAnswer, SupportLlmService } from './support-llm.service';
import { SupportChatService } from './support-chat.service';
import { SUPPORT_FAQ, SUPPORT_KNOWLEDGE, WANTS_HUMAN } from './support-knowledge';
import { FakeDb, fakeSupabase } from '../partners/payout-vault.fakes';

describe('what the assistant may say', () => {
  it('keeps only links on our own domains', () => {
    const out = sanitizeAnswer('Open https://loofta.com/help or https://evil.example/login now');
    expect(out).toContain('https://loofta.com/help');
    expect(out).not.toContain('evil.example');
  });
  it('treats an empty or broken model answer as "ask a person"', () => {
    expect(parseSupportJson('not json')).toBeNull();
    expect(parseSupportJson('{"answer":"","escalate":false}')).toEqual({ answer: '', escalate: true });
    expect(parseSupportJson('{"answer":"Use the email from your payout.","escalate":false}')).toEqual({ answer: 'Use the email from your payout.', escalate: false });
  });
  it('caps the length of an answer', () => {
    expect(sanitizeAnswer('a'.repeat(5000)).length).toBe(700);
  });
  it('knows nothing private: no code, keys, env names, hosts or internal tooling in what the model sees', () => {
    const seen = SUPPORT_KNOWLEDGE + JSON.stringify(SUPPORT_FAQ);
    for (const secret of [/process\.env/i, /supabase/i, /privy/i, /squads/i, /fee.?payer/i, /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/, /\.ts\b/, /railway|fly\.io|vercel/i]) {
      expect(seen).not.toMatch(secret);
    }
  });
  it('only treats a real request as wanting a person', () => {
    expect(WANTS_HUMAN.test('can I talk to a person')).toBe(true);
    expect(WANTS_HUMAN.test('human please')).toBe(true);
    expect(WANTS_HUMAN.test('the person who paid me said it was sent')).toBe(false);
    expect(WANTS_HUMAN.test('send to someone else')).toBe(false);
  });
});

const make = (answer: { answer: string; escalate: boolean } | null, env: Record<string, string> = { SUPPORT_BOT_TOKEN: 't', SUPPORT_TELEGRAM_CHAT_ID: '999' }) => {
  const db = new FakeDb();
  db.rows('users').push({ privy_user_id: 'u1', email: 'a@b.com' });
  const llm = { answer: jest.fn().mockResolvedValue(answer) } as unknown as SupportLlmService;
  const svc = new SupportChatService(fakeSupabase(db) as never, { get: (k: string) => env[k] } as never, llm);
  return { db, svc, llm: llm as unknown as { answer: jest.Mock } };
};
const bodies = (db: FakeDb, sender?: string) => db.rows('support_messages').filter((m) => m.body && (!sender || m.sender === sender)).map((m) => m.body);

describe('support chat', () => {
  it('answers a quick question from the fixed list without asking the model', async () => {
    const { db, svc, llm } = make(null);
    await expect(svc.send('u1', { faq: 'fees' })).resolves.toEqual({ handled: 'faq' });
    expect(llm.answer).not.toHaveBeenCalled();
    expect(bodies(db, 'bot')[0]).toBe(SUPPORT_FAQ.find((f) => f.id === 'fees')!.answer);
  });

  it('shows the assistant answer when it is sure', async () => {
    const { db, svc } = make({ answer: 'Sign in with the payout email.', escalate: false });
    await expect(svc.send('u1', { text: 'why nothing here' })).resolves.toEqual({ handled: 'bot' });
    expect(bodies(db, 'bot')).toContain('Sign in with the payout email.');
  });

  it('hands over to a person when the assistant is unsure or down', async () => {
    for (const out of [{ answer: 'Not sure.', escalate: true }, null]) {
      const { db, svc } = make(out);
      await expect(svc.send('u1', { text: 'my money is missing' })).resolves.toEqual({ handled: 'human' });
      expect(bodies(db, 'bot').join(' ')).toMatch(/team/);
      // the Telegram message is remembered so an agent's reply can find this person
      expect(db.rows('support_messages').some((m) => m.telegram_message_id === 501)).toBe(true);
    }
  });

  it('goes straight to a person when asked, and the memo row never shows in the chat', async () => {
    const { svc, llm } = make(null);
    await svc.send('u1', { text: 'I want to talk to a person' });
    expect(llm.answer).not.toHaveBeenCalled();
    const { messages } = await svc.messages('u1');
    expect(messages.every((m) => m.body.length > 0)).toBe(true);
  });

  it('an agent reply reaches only the person whose message was answered', async () => {
    const { db, svc } = make({ answer: 'x', escalate: true });
    await svc.send('u1', { text: 'help' });
    await expect(svc.agentReply('999', 501, 'We sent it just now.')).resolves.toBe('ok');
    const { messages, mode } = await svc.messages('u1');
    expect(messages.some((m) => m.sender === 'agent' && m.body === 'We sent it just now.')).toBe(true);
    expect(mode).toBe('human');
    expect(await svc.messages('someone-else')).toEqual({ messages: [], mode: 'bot' });
    expect(db.rows('support_threads')).toHaveLength(1);
  });

  it('ignores replies from any chat that is not the team chat, or to unknown messages', async () => {
    const { svc } = make({ answer: 'x', escalate: true });
    await svc.send('u1', { text: 'help' });
    await expect(svc.agentReply('12345', 501, 'hi')).resolves.toBe('unknown');
    await expect(svc.agentReply('999', 777, 'hi')).resolves.toBe('unknown');
  });

  it('once an agent is on it, the next messages go to Telegram instead of the assistant', async () => {
    const { svc, llm } = make({ answer: 'x', escalate: true });
    await svc.send('u1', { text: 'help' });
    await svc.agentReply('999', 501, 'Looking now.');
    llm.answer.mockClear();
    await expect(svc.send('u1', { text: 'thanks, any news?' })).resolves.toEqual({ handled: 'human' });
    expect(llm.answer).not.toHaveBeenCalled();
  });
});

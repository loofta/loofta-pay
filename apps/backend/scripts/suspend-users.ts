// Usage: ts-node scripts/suspend-users.ts <username,username,...> [--apply]
// Default is a read-only dry run. --apply sets suspended_at and sends the suspension email.
// Requires migration 20261106190000_app_users_suspension.sql to be applied first.
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Resend } from 'resend';

dotenv.config({ path: path.join(__dirname, '../.env.local') });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('Missing SUPABASE env'); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const apply = process.argv.includes('--apply');
  const names = (process.argv[2] || '').split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  console.log('project host:', new URL(url!).host, apply ? 'APPLY' : 'DRY RUN');
  for (const name of names) {
    const { data: users } = await supabase.from('app_users').select('privy_user_id, username, email, created_at').eq('username', name);
    if (!users?.length) { console.log(name, '-> not found'); continue; }
    for (const u of users) {
      const { count } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('created_by', u.privy_user_id);
      console.log(name, u.privy_user_id, 'email=', u.email, 'created=', u.created_at, 'payments=', count);
      if (!apply) continue;
      const { error } = await supabase.from('app_users')
        .update({ suspended_at: new Date().toISOString(), suspended_reason: 'fee-payer drain 2026-11-06' })
        .eq('privy_user_id', u.privy_user_id);
      if (error) { console.error('  suspend failed:', error.message); continue; }
      console.log('  suspended');
      if (u.email && process.env.RESEND_API_KEY) {
        const from = process.env.RESEND_FROM_EMAIL || 'noreply@loofta.xyz';
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: `Loofta <${from}>`, to: u.email, replyTo: 'hello@loofta.xyz',
          subject: 'Your Loofta account has been suspended',
          html: '<p>We detected a large number of tiny payments to newly created accounts from your account. Each one costs Loofta network fees and this is not normal use, so we have suspended the account.</p><p>If you think this is a mistake, reply to this email and we will take a look.</p>',
        });
        console.log('  email sent to', u.email);
      } else console.log('  no email on file (or RESEND_API_KEY unset)');
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

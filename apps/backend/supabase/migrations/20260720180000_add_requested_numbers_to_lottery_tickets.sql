-- Add requested_numbers column to lottery_tickets
-- Stores the numbers the user actually picked at purchase time (array of {main: number[], bonus: number}),
-- distinct from ticket_numbers which stores the real post-purchase NFT numbers.
alter table lottery_tickets
  add column if not exists requested_numbers jsonb default null;

-- Add ticket_numbers column to lottery_tickets
-- Stores the numbers the user picked at purchase time (array of {main: number[], bonus: number})
alter table lottery_tickets
  add column if not exists ticket_numbers jsonb default null;

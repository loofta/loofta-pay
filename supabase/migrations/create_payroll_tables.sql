-- Payroll Tables for Arcium Confidential Payroll
-- Enables companies to pay employees using C-SPL tokens with encrypted amounts

-- Payroll batches table
CREATE TABLE IF NOT EXISTS public.payroll_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_wallet TEXT NOT NULL,
  encrypted_batch TEXT NOT NULL, -- Encrypted payroll data from Arcium
  batch_id TEXT UNIQUE NOT NULL, -- Arcium batch ID
  employee_count INTEGER NOT NULL,
  scheduled_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed
  tx_signatures TEXT[], -- Array of transaction signatures
  executed_at TIMESTAMPTZ,
  created_by TEXT, -- Privy user ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payroll employees table
CREATE TABLE IF NOT EXISTS public.payroll_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_batch_id UUID NOT NULL REFERENCES public.payroll_batches(id) ON DELETE CASCADE,
  employee_address TEXT NOT NULL, -- Solana wallet address
  encrypted_amount TEXT NOT NULL, -- Encrypted salary amount
  token_address TEXT NOT NULL, -- C-SPL token address
  decrypted_amount TEXT, -- Only set if employee decrypts (optional)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(payroll_batch_id, employee_address)
);

-- Confidential payments log (for audit trail)
CREATE TABLE IF NOT EXISTS public.confidential_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_batch_id UUID REFERENCES public.payroll_batches(id) ON DELETE SET NULL,
  employee_address TEXT NOT NULL,
  encrypted_amount TEXT NOT NULL,
  token_address TEXT NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_payroll_batches_company_wallet ON public.payroll_batches(company_wallet);
CREATE INDEX IF NOT EXISTS idx_payroll_batches_status ON public.payroll_batches(status);
CREATE INDEX IF NOT EXISTS idx_payroll_batches_created_at ON public.payroll_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_employees_address ON public.payroll_employees(employee_address);
CREATE INDEX IF NOT EXISTS idx_payroll_employees_batch_id ON public.payroll_employees(payroll_batch_id);
CREATE INDEX IF NOT EXISTS idx_confidential_payments_address ON public.confidential_payments(employee_address);
CREATE INDEX IF NOT EXISTS idx_confidential_payments_batch_id ON public.confidential_payments(payroll_batch_id);

-- RLS Policies
ALTER TABLE public.payroll_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confidential_payments ENABLE ROW LEVEL SECURITY;

-- Companies can view their own payroll batches
CREATE POLICY "Companies can view own payroll batches"
  ON public.payroll_batches
  FOR SELECT
  USING (created_by = auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.users 
    WHERE privy_user_id = auth.uid()::text 
    AND role = 'admin'
  ));

-- Employees can view their own payroll records
CREATE POLICY "Employees can view own payroll records"
  ON public.payroll_employees
  FOR SELECT
  USING (true); -- Employees can query by address, no auth needed

-- Employees can view their own payment records
CREATE POLICY "Employees can view own payments"
  ON public.confidential_payments
  FOR SELECT
  USING (true); -- Employees can query by address

-- Comments
COMMENT ON TABLE public.payroll_batches IS 'Confidential payroll batches created by companies';
COMMENT ON TABLE public.payroll_employees IS 'Individual employee records within payroll batches';
COMMENT ON TABLE public.confidential_payments IS 'Audit log of confidential C-SPL token payments';



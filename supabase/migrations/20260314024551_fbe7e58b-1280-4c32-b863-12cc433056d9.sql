ALTER TABLE public.bank_transactions
ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bank_transaction';

COMMENT ON COLUMN public.bank_transactions.source IS 'Origin of the cached row: bank_transaction (Accounting API BankTransactions) or statement_line (Finance API BankStatementsPlus)';
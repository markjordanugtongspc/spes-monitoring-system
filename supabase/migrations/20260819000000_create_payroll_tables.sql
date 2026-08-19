-- Migration: Create Payroll Records and Payroll Budgets Tables
-- ─────────────────────────────────────────────────────────────

-- 1. Create payroll_records table
CREATE TABLE IF NOT EXISTS public.payroll_records (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  beneficiary_id   BIGINT NOT NULL REFERENCES public.beneficiary(id) ON DELETE CASCADE,
  office_id        BIGINT REFERENCES public.offices(id) ON DELETE SET NULL,
  stipend_amount   NUMERIC(12, 2) NOT NULL DEFAULT 5133.00,
  days_worked      SMALLINT NOT NULL DEFAULT 20,
  payment_status   TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (payment_status IN ('PAID', 'PENDING', 'UNPAID')),
  date_paid        TIMESTAMPTZ,
  notes            TEXT,
  created_by       BIGINT REFERENCES public.staffs(id) ON DELETE SET NULL,
  updated_by       BIGINT REFERENCES public.staffs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure 1 payroll record per beneficiary
CREATE UNIQUE INDEX IF NOT EXISTS payroll_records_beneficiary_uniq
  ON public.payroll_records (beneficiary_id);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS payroll_records_office_idx
  ON public.payroll_records (office_id);

CREATE INDEX IF NOT EXISTS payroll_records_status_idx
  ON public.payroll_records (payment_status);

CREATE INDEX IF NOT EXISTS payroll_records_date_paid_idx
  ON public.payroll_records (date_paid);

-- Documentation:
-- date_paid stores full timezone-aware timestamp (TIMESTAMPTZ) with seconds
-- when beneficiary is marked as PAID (e.g. Asia/Manila GMT+08). Set to NULL when reverted to PENDING.

-- Enable RLS and permissive policy for app-level RBAC
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payroll_records' AND policyname = 'payroll_records_all_access'
  ) THEN
    CREATE POLICY "payroll_records_all_access" ON public.payroll_records
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. Create payroll_budgets table
CREATE TABLE IF NOT EXISTS public.payroll_budgets (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  office_id  BIGINT REFERENCES public.offices(id) ON DELETE CASCADE,
  amount     NUMERIC(14, 2) NOT NULL,
  set_by     BIGINT REFERENCES public.staffs(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (office_id)
);

-- Fast lookup index
CREATE INDEX IF NOT EXISTS payroll_budgets_office_idx
  ON public.payroll_budgets (office_id);

-- Enable RLS and permissive policy for app-level RBAC
ALTER TABLE public.payroll_budgets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payroll_budgets' AND policyname = 'payroll_budgets_all_access'
  ) THEN
    CREATE POLICY "payroll_budgets_all_access" ON public.payroll_budgets
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

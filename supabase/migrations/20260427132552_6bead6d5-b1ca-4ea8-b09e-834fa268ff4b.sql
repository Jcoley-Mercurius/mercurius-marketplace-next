ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'pending_release';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'released';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'disputed';

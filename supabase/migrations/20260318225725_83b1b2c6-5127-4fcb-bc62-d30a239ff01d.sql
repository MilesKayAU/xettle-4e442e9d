ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS fulfilment_channel text;
COMMENT ON COLUMN settlement_lines.fulfilment_channel IS 'AFN=FBA, MFN=FBM, MCF=multi-channel, null=unknown';
-- Temporarily disable RLS to delete all data
ALTER TABLE settlement_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_unmapped DISABLE ROW LEVEL SECURITY;
ALTER TABLE settlements DISABLE ROW LEVEL SECURITY;

DELETE FROM settlement_lines;
DELETE FROM settlement_unmapped;
DELETE FROM settlements;

ALTER TABLE settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_unmapped ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
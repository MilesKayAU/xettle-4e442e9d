-- G2 FIX: Archive the orphan kogan_268477 settlement since its period
-- already has a validation row via another settlement
UPDATE settlements SET status = 'archived' WHERE settlement_id = 'kogan_268477';
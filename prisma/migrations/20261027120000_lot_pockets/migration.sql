ALTER TABLE lots ADD COLUMN pocket_weight_kg NUMERIC(12,3);
ALTER TABLE lots ADD CONSTRAINT lots_pocket_weight_nonnegative CHECK (pocket_weight_kg >= 0);
-- NULL preserves the unreviewed packaging breakdown of existing lots.

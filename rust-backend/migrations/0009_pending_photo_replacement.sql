-- Keep the currently published main photo unchanged during candidate checks.
-- The baseline guards replacement against another device changing the photo.
ALTER TABLE face_verification_attempts ADD COLUMN replacement_base jsonb;
ALTER TABLE face_verification_attempts ADD CONSTRAINT replacement_base_object
  CHECK (replacement_base IS NULL OR jsonb_typeof(replacement_base) = 'object');

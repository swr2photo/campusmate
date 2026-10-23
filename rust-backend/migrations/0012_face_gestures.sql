-- Face ID-style gesture phase that runs before AWS Face Liveness. The server
-- picks a random order; each frame is checked in memory and never stored.
-- Gestures add a layer in front of AWS's check and never replace it.
ALTER TABLE face_verification_attempts
    ADD COLUMN gesture_sequence text[],
    ADD COLUMN gesture_step smallint NOT NULL DEFAULT 0,
    ADD COLUMN gesture_failures smallint NOT NULL DEFAULT 0,
    -- Yaw sign of the first head turn; the second turn must be the opposite.
    ADD COLUMN gesture_turn_sign smallint,
    -- One frame is evaluated at a time per attempt.
    ADD COLUMN gesture_lease_until timestamptz,
    ADD COLUMN gestures_passed_at timestamptz;

ALTER TABLE face_verification_attempts
    ADD CONSTRAINT face_gesture_sequence_valid CHECK (
        gesture_sequence IS NULL OR (
            cardinality(gesture_sequence) BETWEEN 1 AND 8
            AND gesture_sequence <@ ARRAY['CENTER', 'BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'NOD_DOWN']::text[]
        )
    ),
    ADD CONSTRAINT face_gesture_step_valid CHECK (
        gesture_step >= 0
        AND (gesture_sequence IS NULL OR gesture_step <= cardinality(gesture_sequence))
    ),
    ADD CONSTRAINT face_gesture_failures_valid CHECK (gesture_failures BETWEEN 0 AND 100),
    ADD CONSTRAINT face_gesture_turn_sign_valid CHECK (gesture_turn_sign IS NULL OR gesture_turn_sign IN (-1, 1)),
    ADD CONSTRAINT face_gestures_passed_complete CHECK (
        gestures_passed_at IS NULL OR gesture_step = cardinality(gesture_sequence)
    );

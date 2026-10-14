-- Each decision records the action that currently owns its value. Rewind may
-- restore only that exact pending action, never a later acceptance or rejection.
ALTER TABLE decisions ADD COLUMN last_action_id uuid;

CREATE TABLE matching_history (
    actor_id text NOT NULL REFERENCES accounts(id),
    action_id uuid NOT NULL,
    target_id text NOT NULL REFERENCES accounts(id),
    sequence bigint GENERATED ALWAYS AS IDENTITY,
    previous jsonb CHECK (previous IS NULL OR jsonb_typeof(previous)='object'),
    undoable boolean NOT NULL DEFAULT true,
    undone_at timestamptz,
    undo_reason text CHECK (undo_reason IN ('rewind','unavailable','relationship-changed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id,action_id), CHECK(actor_id<>target_id)
);
CREATE INDEX matching_history_latest ON matching_history(actor_id,sequence DESC) WHERE undoable;
CREATE INDEX matching_history_pair ON matching_history(actor_id,target_id) WHERE undoable;

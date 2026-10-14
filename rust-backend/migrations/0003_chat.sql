-- Existing direct-room and message IDs remain intact during import.
ALTER TABLE conversations ADD COLUMN encryption jsonb;
ALTER TABLE conversations ADD COLUMN encryption_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conversations ADD CONSTRAINT conversation_encryption_object
    CHECK (encryption IS NULL OR jsonb_typeof(encryption)='object');
-- Message IDs are TEXT in the initial schema; preserve legacy IDs verbatim.
ALTER TABLE encrypted_messages ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX encrypted_messages_sequence ON encrypted_messages(conversation_id,sequence);
CREATE INDEX encrypted_messages_sequence_page ON encrypted_messages(conversation_id,sequence DESC);

-- A block and a message/key-envelope write take the same room lock. Once a
-- block commits, a waiting send observes it before writing. This also covers
-- block mutations made through the existing profile endpoint.
CREATE FUNCTION lock_block_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pair_a text; pair_b text;
BEGIN
    IF TG_OP='DELETE' THEN
        pair_a := LEAST(OLD.actor_id,OLD.target_id);
        pair_b := GREATEST(OLD.actor_id,OLD.target_id);
    ELSE
        pair_a := LEAST(NEW.actor_id,NEW.target_id);
        pair_b := GREATEST(NEW.actor_id,NEW.target_id);
    END IF;
    PERFORM id FROM conversations WHERE member_a=pair_a AND member_b=pair_b FOR UPDATE;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER blocks_lock_room BEFORE INSERT OR DELETE ON blocks
    FOR EACH ROW EXECUTE FUNCTION lock_block_conversation();

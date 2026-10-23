ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
ALTER TABLE group_messages
    ADD CONSTRAINT group_messages_type_check CHECK (type IN ('text', 'image', 'audio', 'gif', 'track'));

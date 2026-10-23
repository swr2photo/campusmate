-- Per-member inbox organization, independent of message delivery/read receipts.
ALTER TABLE conversation_members
    ADD COLUMN pinned boolean NOT NULL DEFAULT false,
    ADD COLUMN marked_unread boolean NOT NULL DEFAULT false;

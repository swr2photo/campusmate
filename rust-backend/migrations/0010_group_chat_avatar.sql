ALTER TABLE group_chats
    ADD COLUMN avatar_uri text NOT NULL DEFAULT '' CHECK (length(avatar_uri) <= 2000);

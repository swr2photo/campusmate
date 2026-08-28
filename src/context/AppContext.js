import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  CAMPUS_SPOTS,
  CURRENT_USER,
  INITIAL_CONVERSATIONS,
  MATCH_PROFILES,
} from '../data/mockData';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [profile, setProfile] = useState(CURRENT_USER);
  const [conversations, setConversations] = useState(INITIAL_CONVERSATIONS);
  const [dismissedProfileIds, setDismissedProfileIds] = useState([]);
  const [matchedProfileIds, setMatchedProfileIds] = useState(['p1', 'p2']);
  const [selectedMeetup, setSelectedMeetup] = useState(null);

  const availableProfiles = useMemo(
    () => MATCH_PROFILES.filter((candidate) => !dismissedProfileIds.includes(candidate.id)),
    [dismissedProfileIds]
  );

  const dismissProfile = (profileId) => {
    setDismissedProfileIds((current) => (
      current.includes(profileId) ? current : [...current, profileId]
    ));
  };

  const resetMatching = () => setDismissedProfileIds([]);

  const matchProfile = (candidate) => {
    setMatchedProfileIds((current) => (
      current.includes(candidate.id) ? current : [...current, candidate.id]
    ));

    setConversations((current) => {
      if (current.some((conversation) => conversation.profileId === candidate.id)) {
        return current;
      }

      return [
        {
          id: `c-${candidate.id}`,
          profileId: candidate.id,
          name: candidate.name,
          subtitle: `${candidate.activityLabel} · ${candidate.skill}`,
          avatar: candidate.avatar,
          avatarColor: candidate.avatarColor,
          online: true,
          unread: 0,
          updatedAt: 'ตอนนี้',
          lastMessage: 'เริ่มบทสนทนาได้เลย',
          messages: [],
        },
        ...current,
      ];
    });

    dismissProfile(candidate.id);
  };

  const sendMessage = (conversationId, text) => {
    const trimmedText = text.trim();
    if (!trimmedText) return false;

    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      return {
        ...conversation,
        lastMessage: trimmedText,
        updatedAt: 'ตอนนี้',
        unread: 0,
        messages: [
          ...conversation.messages,
          { id: `m-${Date.now()}`, sender: 'me', text: trimmedText, time: 'ตอนนี้' },
        ],
      };
    }));
    return true;
  };

  const saveProfile = (nextProfile) => {
    setProfile((current) => ({ ...current, ...nextProfile }));
  };

  const chooseMeetup = (spot) => {
    setSelectedMeetup({ ...spot, scheduledAt: 'ยังไม่ได้กำหนดเวลา' });
  };

  const clearMeetup = () => setSelectedMeetup(null);

  const value = useMemo(() => ({
    profile,
    conversations,
    availableProfiles,
    matchedProfileIds,
    campusSpots: CAMPUS_SPOTS,
    selectedMeetup,
    dismissProfile,
    resetMatching,
    matchProfile,
    sendMessage,
    saveProfile,
    chooseMeetup,
    clearMeetup,
  }), [
    profile,
    conversations,
    availableProfiles,
    matchedProfileIds,
    selectedMeetup,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp ต้องอยู่ภายใน AppProvider');
  return context;
}

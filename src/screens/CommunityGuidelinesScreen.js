import React from 'react';
import LegalDocumentView from '../components/LegalDocumentView';
import { COMMUNITY_INTRO, COMMUNITY_SECTIONS } from '../content/legalDocuments';

export default function CommunityGuidelinesScreen() {
  return (
    <LegalDocumentView
      badgeIcon="checkmark.seal.fill"
      badgeLabel="นโยบายชุมชนและความปลอดภัย"
      intro={COMMUNITY_INTRO}
      sections={COMMUNITY_SECTIONS}
    />
  );
}

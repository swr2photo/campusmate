import React from 'react';
import LegalDocumentView from '../components/LegalDocumentView';
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from '../content/legalDocuments';

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocumentView
      badgeIcon="lock.shield.fill"
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
    />
  );
}

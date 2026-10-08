import React from 'react';
import LegalDocumentView from '../components/LegalDocumentView';
import { LEGAL_NOTICE_INTRO, LEGAL_NOTICE_SECTIONS } from '../content/legalDocuments';

export default function LegalNoticeScreen() {
  return (
    <LegalDocumentView
      badgeIcon="doc.text.fill"
      badgeLabel="ข้อกำหนดทางกฎหมาย"
      intro={LEGAL_NOTICE_INTRO}
      sections={LEGAL_NOTICE_SECTIONS}
    />
  );
}

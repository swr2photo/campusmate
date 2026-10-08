import React from 'react';
import LegalDocumentView from '../components/LegalDocumentView';
import { TERMS_INTRO, TERMS_SECTIONS } from '../content/legalDocuments';

export default function TermsOfServiceScreen() {
  return (
    <LegalDocumentView
      badgeIcon="hand.raised.fill"
      badgeLabel="ข้อตกลงการใช้บริการ"
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
    />
  );
}

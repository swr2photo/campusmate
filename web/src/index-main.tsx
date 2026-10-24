import { mountApp } from './mount';
import { ContinuePage } from './continue-page';
import { LandingPage } from './landing-page';

// Very old account emails linked to the site root with Firebase action
// parameters. Send them to the page that handles that action; everyone else
// gets the homepage.
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');
const target = !params.has('oobCode') ? null
  : mode === 'resetPassword' ? '/reset.html'
    : mode === 'verifyEmail' || mode === 'recoverEmail' || mode === 'verifyAndChangeEmail' ? '/email-verified.html'
      : null;

if (target) {
  window.location.replace(`${target}${window.location.search}`);
} else {
  const legacy = params.has('mode') || params.has('oobCode');
  // A one-time code must not linger in history or leak through Referer.
  if (legacy) window.history.replaceState(null, '', window.location.pathname);
  mountApp(legacy ? <ContinuePage /> : <LandingPage />);
}

import { createContext } from 'react';

// A composite RN gesture owner keeps one responder hierarchy for nested taps.
export default createContext(false);

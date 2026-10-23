import { createContext, useContext } from 'react';

// True while a screen is rendered by SwipeableTabContainer as the preview of a
// neighbouring tab. Previews live inside the *current* tab's navigation screen,
// so they must not register native header items (Stack.SearchBar,
// Stack.Toolbar, Stack.Screen options): those would attach to the current
// tab's navigation bar instead of their own.
const TabPreviewContext = createContext(false);

export const TabPreviewProvider = TabPreviewContext.Provider;

export function useIsTabPreview() {
  return useContext(TabPreviewContext);
}

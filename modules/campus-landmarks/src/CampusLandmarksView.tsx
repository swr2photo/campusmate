// Android and web deliberately avoid importing or registering the iOS native view.
export { default } from './CampusLandmarksFallback';

export function isCampusLandmarksAvailable(): boolean {
  return false;
}

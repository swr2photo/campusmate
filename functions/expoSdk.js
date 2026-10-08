// expo-server-sdk is loaded lazily so cold starts of functions that never send
// push notifications do not pay for it. Every caller must obtain `Expo` (static
// token validation) and `client` (sending/receipts) from this loader; there is
// deliberately no module-level `Expo` binding in index.js.
let expoSdkPromise = null;

export function getExpoSdk() {
  if (!expoSdkPromise) {
    expoSdkPromise = import('expo-server-sdk')
      .then(({ Expo }) => ({ Expo, client: new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN }) }))
      .catch((error) => {
        expoSdkPromise = null;
        throw error;
      });
  }
  return expoSdkPromise;
}

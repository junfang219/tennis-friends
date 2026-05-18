import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennisfriend.app',
  appName: 'TennisFriend',
  webDir: 'out',
  server: {
    // During development, load from the Next.js dev server.
    // For the iOS Simulator, `http://localhost:3000` works (the simulator
    // shares the Mac's network). For a physical iPhone on the same Wi-Fi,
    // replace with your Mac's LAN IP (e.g. http://192.168.7.129:3000).
    // For production, change to your deployed URL and remove cleartext.
    url: 'http://localhost:3000',
    cleartext: true,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;

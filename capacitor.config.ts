import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennisfriend.app',
  appName: 'TennisFriend',
  webDir: 'out',
  server: {
    // During development, load from the Next.js dev server.
    // For production, change to your deployed URL and remove cleartext.
    url: 'http://192.168.7.129:3000',
    cleartext: true,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;

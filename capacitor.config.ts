import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jeffrey.moment',
  appName: '拾光记',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config


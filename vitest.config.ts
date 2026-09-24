import { defineConfig } from 'vitest/config';
export default defineConfig({ define: { __API_ORIGIN__: JSON.stringify('https://x.aileetcode.com') }, test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 } });

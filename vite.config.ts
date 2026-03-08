
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Set the server port to 8080 as required
  server: {
    host: "::",
    port: 8080,
    fs: {
      // Allow serving files from the project root
      allow: ['.'],
      // Exclude Git-related files from discovery to avoid errors
      deny: ['**/.git/**'],
    },
  },
}))

import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

declare global {
  interface Window {
    host?: {
      saveFile(defaultName: string, contents: string): Promise<{ ok: boolean; filePath?: string }>;
      openFile(): Promise<{ ok: boolean; contents?: string }>;
      appVersion(): Promise<string>;
      onHidChanged(fn: () => void): () => void;
    };
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

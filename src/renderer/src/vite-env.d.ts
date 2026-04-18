/// <reference types="vite/client" />

import type { AnvilBridge } from '../../shared/anvil-api';

declare global {
  interface Window {
    anvil: AnvilBridge;
  }
}

export {};

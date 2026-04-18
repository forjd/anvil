/// <reference types="vite/client" />

interface Window {
  anvil: {
    platform: NodeJS.Platform;
    versions: {
      chrome: string;
      electron: string;
      node: string;
    };
  };
}

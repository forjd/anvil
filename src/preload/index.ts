import { contextBridge, ipcRenderer } from 'electron';

import {
  ANVIL_IPC_CHANNELS,
  type AnvilBridge,
  type AuthProgressEvent,
  type AuthPromptRequest,
  type ChatStreamEvent,
  type CreateSessionResult,
  type PromptRunResult,
  type SendMessageResult,
  type SessionDetail,
  type SessionSummary,
  type WorkspaceSelectionResult,
} from '../shared/anvil-api';

const anvilBridge: AnvilBridge = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  workspacePath: process.cwd(),
  cancelAuthPrompt(requestId) {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.authCancelPrompt, requestId) as Promise<void>;
  },
  createSession() {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.chatCreateSession) as Promise<CreateSessionResult>;
  },
  getAuthOverview() {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.authGetOverview) as Promise<
      Awaited<ReturnType<AnvilBridge['getAuthOverview']>>
    >;
  },
  listSessions() {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.chatListSessions) as Promise<SessionSummary[]>;
  },
  loadSession(sessionId) {
    return ipcRenderer.invoke(
      ANVIL_IPC_CHANNELS.chatLoadSession,
      sessionId,
    ) as Promise<SessionDetail>;
  },
  login(providerId) {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.authLogin, providerId) as Promise<
      Awaited<ReturnType<AnvilBridge['login']>>
    >;
  },
  logout(providerId) {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.authLogout, providerId) as Promise<
      Awaited<ReturnType<AnvilBridge['logout']>>
    >;
  },
  onAuthProgress(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AuthProgressEvent) => {
      listener(payload);
    };

    ipcRenderer.on(ANVIL_IPC_CHANNELS.authProgress, wrapped);
    return () => {
      ipcRenderer.removeListener(ANVIL_IPC_CHANNELS.authProgress, wrapped);
    };
  },
  onAuthPrompt(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AuthPromptRequest) => {
      listener(payload);
    };

    ipcRenderer.on(ANVIL_IPC_CHANNELS.authPrompt, wrapped);
    return () => {
      ipcRenderer.removeListener(ANVIL_IPC_CHANNELS.authPrompt, wrapped);
    };
  },
  onChatStream(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent) => {
      listener(payload);
    };

    ipcRenderer.on(ANVIL_IPC_CHANNELS.chatStream, wrapped);
    return () => {
      ipcRenderer.removeListener(ANVIL_IPC_CHANNELS.chatStream, wrapped);
    };
  },
  runPrompt(request) {
    return ipcRenderer.invoke(ANVIL_IPC_CHANNELS.promptRun, request) as Promise<PromptRunResult>;
  },
  selectWorkspace() {
    return ipcRenderer.invoke(
      ANVIL_IPC_CHANNELS.workspaceSelect,
    ) as Promise<WorkspaceSelectionResult>;
  },
  sendMessage(request) {
    return ipcRenderer.invoke(
      ANVIL_IPC_CHANNELS.chatSendMessage,
      request,
    ) as Promise<SendMessageResult>;
  },
  submitAuthPrompt(requestId, value) {
    return ipcRenderer.invoke(
      ANVIL_IPC_CHANNELS.authSubmitPrompt,
      requestId,
      value,
    ) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('anvil', anvilBridge);

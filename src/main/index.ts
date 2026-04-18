import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';

import {
  createConversationSession,
  createHarnessRuntime,
  getHarnessPaths,
  listConversationSessions,
  loadConversationSession,
  runTextPrompt,
  sendConversationMessage,
  type AuthRecord,
  type OAuthLoginCallbacks,
} from '../harness';
import {
  ANVIL_IPC_CHANNELS,
  type AuthActionResult,
  type AuthOverview,
  type AuthProgressEvent,
  type AuthPromptRequest,
  type CreateSessionResult,
  type PromptRunRequest,
  type PromptRunResult,
  type SendMessageRequest,
  type SendMessageResult,
  type SessionDetail,
  type SessionSummary,
} from '../shared/anvil-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtime = createHarnessRuntime();
const workspacePath = process.cwd();

const runtimeSummary = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  workspacePath,
} as const;

interface PendingAuthPrompt {
  reject(error: Error): void;
  resolve(value: string): void;
  webContentsId: number;
}

const pendingAuthPrompts = new Map<string, PendingAuthPrompt>();
let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
  const windowInstance = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'Anvil',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const webContentsId = windowInstance.webContents.id;

  mainWindow = windowInstance;

  windowInstance.on('closed', () => {
    rejectPromptsForWebContents(webContentsId, 'The window was closed.');

    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void windowInstance.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void windowInstance.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

const emitAuthProgress = (webContents: WebContents, event: AuthProgressEvent): void => {
  if (webContents.isDestroyed()) {
    return;
  }

  webContents.send(ANVIL_IPC_CHANNELS.authProgress, event);
};

const requestAuthPrompt = (
  webContents: WebContents,
  providerId: string,
  message: string,
): Promise<string> => {
  const requestId = randomUUID();
  const prompt: AuthPromptRequest = {
    message,
    providerId,
    requestId,
  };

  webContents.send(ANVIL_IPC_CHANNELS.authPrompt, prompt);

  return new Promise<string>((resolve, reject) => {
    pendingAuthPrompts.set(requestId, {
      reject,
      resolve,
      webContentsId: webContents.id,
    });
  });
};

const rejectPromptsForWebContents = (webContentsId: number, reason: string): void => {
  for (const [requestId, pendingPrompt] of pendingAuthPrompts.entries()) {
    if (pendingPrompt.webContentsId === webContentsId) {
      pendingPrompt.reject(new Error(reason));
      pendingAuthPrompts.delete(requestId);
    }
  }
};

const createAuthOverview = async (): Promise<AuthOverview> => {
  const authRecords = await runtime.authStorage.load();

  return {
    ...runtimeSummary,
    authFilePath: getHarnessPaths().authFilePath,
    providers: runtime.providerRegistry.list().map((provider) => {
      const record = authRecords[provider.id];
      return {
        connected: Boolean(record),
        connectionKind: getConnectionKind(record),
        hasOAuth: Boolean(provider.oauth),
        id: provider.id,
        models: provider.models.map((model) => ({ id: model.id, name: model.name })),
        name: provider.name,
      };
    }),
  };
};

const getConnectionKind = (record: AuthRecord | undefined): 'api_key' | 'none' | 'oauth' => {
  if (!record) {
    return 'none';
  }

  return record.type;
};

const createActionResult = async (
  providerId: string,
  ok: boolean,
  message: string,
  error?: string,
): Promise<AuthActionResult> => ({
  error,
  message,
  ok,
  overview: await createAuthOverview(),
  providerId,
});

const createLoginCallbacks = (
  webContents: WebContents,
  providerId: string,
): OAuthLoginCallbacks => ({
  onAuth({ instructions, url }) {
    emitAuthProgress(webContents, {
      instructions,
      level: 'info',
      message: instructions ?? `Opening browser for ${providerId} authentication...`,
      providerId,
      timestamp: Date.now(),
      url,
    });

    void shell.openExternal(url);
  },
  onManualCodeInput() {
    return requestAuthPrompt(
      webContents,
      providerId,
      "Optional fallback: paste the full redirect URL or authorization code here if the browser doesn't return to Anvil automatically.",
    );
  },
  onProgress(message) {
    emitAuthProgress(webContents, {
      level: 'info',
      message,
      providerId,
      timestamp: Date.now(),
    });
  },
  onPrompt({ message }) {
    return requestAuthPrompt(webContents, providerId, message);
  },
});

ipcMain.handle(ANVIL_IPC_CHANNELS.authGetOverview, async () => createAuthOverview());

ipcMain.handle(
  ANVIL_IPC_CHANNELS.chatListSessions,
  async (): Promise<SessionSummary[]> => listConversationSessions(runtime, workspacePath),
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.chatCreateSession,
  async (): Promise<CreateSessionResult> => ({
    detail: await createConversationSession(runtime, workspacePath),
  }),
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.chatLoadSession,
  async (_event: IpcMainInvokeEvent, sessionId: string): Promise<SessionDetail> =>
    loadConversationSession(runtime, sessionId),
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.chatSendMessage,
  async (_event: IpcMainInvokeEvent, request: SendMessageRequest): Promise<SendMessageResult> => {
    try {
      const detail = await sendConversationMessage(runtime, request);
      return {
        detail,
        ok: true,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  },
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.authLogin,
  async (event: IpcMainInvokeEvent, providerId: string): Promise<AuthActionResult> => {
    const provider = runtime.providerRegistry.get(providerId);
    if (!provider) {
      return createActionResult(providerId, false, 'Provider not found.', 'Provider not found.');
    }

    if (!provider.oauth) {
      return createActionResult(
        providerId,
        false,
        `${provider.name} does not support interactive login.`,
        `${provider.name} does not support interactive login.`,
      );
    }

    emitAuthProgress(event.sender, {
      level: 'info',
      message: `Starting ${provider.name} login...`,
      providerId,
      timestamp: Date.now(),
    });

    try {
      const credentials = await provider.oauth.login(
        createLoginCallbacks(event.sender, providerId),
      );
      await runtime.authStorage.set(providerId, {
        credentials,
        providerId,
        type: 'oauth',
      });

      emitAuthProgress(event.sender, {
        level: 'success',
        message: `Connected ${provider.name}.`,
        providerId,
        timestamp: Date.now(),
      });

      return createActionResult(providerId, true, `Connected ${provider.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      emitAuthProgress(event.sender, {
        level: 'error',
        message,
        providerId,
        timestamp: Date.now(),
      });

      return createActionResult(providerId, false, `Failed to connect ${provider.name}.`, message);
    } finally {
      rejectPromptsForWebContents(event.sender.id, 'Authentication flow completed.');
    }
  },
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.authLogout,
  async (_event: IpcMainInvokeEvent, providerId: string): Promise<AuthActionResult> => {
    const provider = runtime.providerRegistry.get(providerId);
    await runtime.authStorage.remove(providerId);

    return createActionResult(
      providerId,
      true,
      provider ? `Removed local credentials for ${provider.name}.` : 'Removed local credentials.',
    );
  },
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.promptRun,
  async (_event: IpcMainInvokeEvent, request: PromptRunRequest): Promise<PromptRunResult> => {
    try {
      const result = await runTextPrompt(runtime, request);
      return {
        modelId: request.modelId,
        ok: true,
        prompt: request.prompt,
        providerId: request.providerId,
        responseText: result.responseText,
        stopReason: result.assistant.stopReason,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        modelId: request.modelId,
        ok: false,
        prompt: request.prompt,
        providerId: request.providerId,
      };
    }
  },
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.authSubmitPrompt,
  (event: IpcMainInvokeEvent, requestId: string, value: string): void => {
    const pendingPrompt = pendingAuthPrompts.get(requestId);
    if (!pendingPrompt) {
      throw new Error(`No auth prompt found for request ${requestId}.`);
    }

    if (pendingPrompt.webContentsId !== event.sender.id) {
      throw new Error('Auth prompt belongs to a different renderer process.');
    }

    pendingAuthPrompts.delete(requestId);
    pendingPrompt.resolve(value);
  },
);

ipcMain.handle(
  ANVIL_IPC_CHANNELS.authCancelPrompt,
  (event: IpcMainInvokeEvent, requestId: string): void => {
    const pendingPrompt = pendingAuthPrompts.get(requestId);
    if (!pendingPrompt) {
      return;
    }

    if (pendingPrompt.webContentsId !== event.sender.id) {
      throw new Error('Auth prompt belongs to a different renderer process.');
    }

    pendingAuthPrompts.delete(requestId);
    pendingPrompt.reject(new Error('Authentication prompt cancelled.'));
  },
);

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

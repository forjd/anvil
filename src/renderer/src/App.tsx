import { useEffect, useMemo, useState } from 'react';

import type {
  AuthActionResult,
  AuthOverview,
  AuthProgressEvent,
  AuthPromptRequest,
  AuthProviderSummary,
  ConversationMessage,
  SessionDetail,
  SessionSummary,
} from '../../shared/anvil-api';

const formatTimestamp = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);

const formatUpdatedAt = (timestamp: number): string => {
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60_000);

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getConnectionLabel = (provider: AuthProviderSummary): string => {
  if (!provider.connected) {
    return 'Not connected';
  }

  if (provider.connectionKind === 'oauth') {
    return 'Connected via OAuth';
  }

  if (provider.connectionKind === 'api_key') {
    return 'Connected via API key';
  }

  return 'Connected';
};

const upsertSession = (
  sessions: SessionSummary[],
  nextSession: SessionSummary,
): SessionSummary[] => {
  const remaining = sessions.filter((session) => session.id !== nextSession.id);
  return [nextSession, ...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
};

const messageBody = (message: ConversationMessage): string => {
  if (message.text.trim().length > 0) {
    return message.text;
  }

  if (message.role === 'assistant' && message.stopReason === 'error') {
    return '(assistant returned an error)';
  }

  return '(empty message)';
};

export default function App() {
  const [authOverview, setAuthOverview] = useState<AuthOverview | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptRequest | null>(null);
  const [authPromptValue, setAuthPromptValue] = useState('');
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [events, setEvents] = useState<AuthProgressEvent[]>([]);
  const [lastAuthResult, setLastAuthResult] = useState<AuthActionResult | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [composerText, setComposerText] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState<{ text: string; timestamp: number } | null>(
    null,
  );
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      try {
        const [overview, existingSessions] = await Promise.all([
          window.anvil.getAuthOverview(),
          window.anvil.listSessions(),
        ]);

        if (cancelled) {
          return;
        }

        setAuthOverview(overview);
        setSessions(existingSessions);

        const firstExistingSession = existingSessions[0];
        if (firstExistingSession) {
          const firstSession = await window.anvil.loadSession(firstExistingSession.id);
          if (cancelled) {
            return;
          }

          setActiveSessionId(firstSession.session.id);
          setSessionDetail(firstSession);
        } else {
          const created = await window.anvil.createSession();
          if (cancelled) {
            return;
          }

          setSessions([created.detail.session]);
          setActiveSessionId(created.detail.session.id);
          setSessionDetail(created.detail);
        }
      } catch (error) {
        if (!cancelled) {
          setChatError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    const offProgress = window.anvil.onAuthProgress((event) => {
      setEvents((current) => [event, ...current].slice(0, 20));
    });

    const offPrompt = window.anvil.onAuthPrompt((prompt) => {
      setAuthPrompt(prompt);
      setAuthPromptValue('');
    });

    return () => {
      cancelled = true;
      offProgress();
      offPrompt();
    };
  }, []);

  const connectedProvider = useMemo(
    () =>
      authOverview?.providers.find(
        (provider) => provider.connected && provider.models.length > 0,
      ) ?? null,
    [authOverview],
  );
  const activeModel = connectedProvider?.models[0] ?? null;
  const orderedEvents = useMemo(() => events, [events]);
  const renderedMessages = useMemo(() => {
    const baseMessages = sessionDetail?.messages ?? [];
    if (!pendingPrompt) {
      return baseMessages;
    }

    return [
      ...baseMessages,
      {
        id: 'pending-user',
        role: 'user' as const,
        text: pendingPrompt.text,
        timestamp: pendingPrompt.timestamp,
      },
      {
        id: 'pending-assistant',
        role: 'assistant' as const,
        stopReason: 'stop' as const,
        text: 'Thinking…',
        timestamp: pendingPrompt.timestamp,
      },
    ];
  }, [pendingPrompt, sessionDetail]);

  const loadSession = async (sessionId: string): Promise<void> => {
    setIsLoadingSession(true);
    setChatError(null);

    try {
      const detail = await window.anvil.loadSession(sessionId);
      setActiveSessionId(detail.session.id);
      setSessionDetail(detail);
      setSessions((current) => upsertSession(current, detail.session));
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingSession(false);
    }
  };

  const handleCreateSession = async (): Promise<void> => {
    setChatError(null);

    try {
      const created = await window.anvil.createSession();
      setActiveSessionId(created.detail.session.id);
      setSessionDetail(created.detail);
      setSessions((current) => upsertSession(current, created.detail.session));
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLogin = async (providerId: string): Promise<void> => {
    setBusyProviderId(providerId);
    setLastAuthResult(null);

    try {
      const result = await window.anvil.login(providerId);
      setLastAuthResult(result);
      setAuthOverview(result.overview);
    } finally {
      setAuthPrompt(null);
      setAuthPromptValue('');
      setBusyProviderId(null);
    }
  };

  const handleLogout = async (providerId: string): Promise<void> => {
    setBusyProviderId(providerId);
    setLastAuthResult(null);

    try {
      const result = await window.anvil.logout(providerId);
      setLastAuthResult(result);
      setAuthOverview(result.overview);
    } finally {
      setAuthPrompt(null);
      setAuthPromptValue('');
      setBusyProviderId(null);
    }
  };

  const handleSubmitPrompt = async (): Promise<void> => {
    if (!authPrompt) {
      return;
    }

    await window.anvil.submitAuthPrompt(authPrompt.requestId, authPromptValue);
    setAuthPrompt(null);
    setAuthPromptValue('');
  };

  const handleCancelPrompt = async (): Promise<void> => {
    if (!authPrompt) {
      return;
    }

    await window.anvil.cancelAuthPrompt(authPrompt.requestId);
    setAuthPrompt(null);
    setAuthPromptValue('');
  };

  const handleSendMessage = async (): Promise<void> => {
    if (
      !connectedProvider ||
      !activeModel ||
      !activeSessionId ||
      composerText.trim().length === 0 ||
      isSendingMessage
    ) {
      return;
    }

    const prompt = composerText.trim();
    setComposerText('');
    setPendingPrompt({ text: prompt, timestamp: Date.now() });
    setIsSendingMessage(true);
    setChatError(null);

    try {
      const result = await window.anvil.sendMessage({
        modelId: activeModel.id,
        prompt,
        providerId: connectedProvider.id,
        sessionId: activeSessionId,
      });

      if (!result.ok || !result.detail) {
        throw new Error(result.error || 'Message send failed.');
      }

      setSessionDetail(result.detail);
      setSessions((current) => upsertSession(current, result.detail!.session));
      setActiveSessionId(result.detail.session.id);
    } catch (error) {
      setComposerText(prompt);
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingPrompt(null);
      setIsSendingMessage(false);
    }
  };

  return (
    <main className="shell-root">
      <header className="topbar card">
        <div className="topbar-section">
          <p className="eyebrow">forjd / anvil</p>
          <h1>Anvil</h1>
          <p className="subtle-text">Desktop coding agent for local repositories.</p>
        </div>

        <div className="topbar-status">
          <div className="status-cluster">
            <span className="meta-label">Workspace</span>
            <code className="path-chip">
              {authOverview?.workspacePath ?? window.anvil.workspacePath}
            </code>
          </div>
          <div className="status-cluster">
            <span className="meta-label">Model</span>
            <span
              className={`status-pill ${connectedProvider ? 'status-pill-connected' : 'status-pill-idle'}`}
            >
              {connectedProvider && activeModel
                ? `${connectedProvider.name} · ${activeModel.name}`
                : 'Connect OpenAI Codex'}
            </span>
          </div>
        </div>
      </header>

      {lastAuthResult ? (
        <section className={`banner ${lastAuthResult.ok ? 'banner-success' : 'banner-error'}`}>
          <strong>{lastAuthResult.message}</strong>
          {lastAuthResult.error ? <span>{lastAuthResult.error}</span> : null}
        </section>
      ) : null}

      {chatError ? (
        <section className="banner banner-error">
          <strong>Chat error</strong>
          <span>{chatError}</span>
        </section>
      ) : null}

      {authPrompt ? (
        <section className="modal-overlay">
          <div className="card prompt-modal">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Prompt required</p>
                <h2>{authPrompt.providerId}</h2>
              </div>
            </div>

            <p className="prompt-message">{authPrompt.message}</p>

            <label className="prompt-label" htmlFor="auth-prompt-input">
              Authorization input
            </label>
            <input
              id="auth-prompt-input"
              className="text-input"
              type="text"
              placeholder="Paste code or redirect URL"
              value={authPromptValue}
              onChange={(event) => {
                setAuthPromptValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && authPromptValue.trim().length > 0) {
                  event.preventDefault();
                  void handleSubmitPrompt();
                }
              }}
            />

            <div className="button-row">
              <button
                className="button button-primary"
                disabled={authPromptValue.trim().length === 0}
                onClick={() => {
                  void handleSubmitPrompt();
                }}
                type="button"
              >
                Submit
              </button>
              <button
                className="button button-secondary"
                onClick={() => {
                  void handleCancelPrompt();
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="app-layout">
        <aside className="sidebar card">
          <div className="sidebar-header">
            <div>
              <p className="eyebrow">Sessions</p>
              <h2>Conversations</h2>
            </div>
            <button
              className="button button-secondary"
              onClick={() => {
                void handleCreateSession();
              }}
              type="button"
            >
              New chat
            </button>
          </div>

          <div className="session-list">
            {sessions.map((session) => (
              <button
                className={`session-item ${session.id === activeSessionId ? 'session-item-active' : ''}`}
                key={session.id}
                onClick={() => {
                  void loadSession(session.id);
                }}
                type="button"
              >
                <strong>{session.title}</strong>
                <span className="subtle-text">
                  {session.messageCount} messages · {formatUpdatedAt(session.updatedAt)}
                </span>
              </button>
            ))}
          </div>

          <details className="dev-panel">
            <summary>Developer tools</summary>

            <section className="dev-section">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Auth</p>
                  <h2>Provider connections</h2>
                </div>
              </div>

              <div className="provider-list">
                {authOverview?.providers.map((provider) => {
                  const isBusy = busyProviderId === provider.id;

                  return (
                    <section className="provider-card" key={provider.id}>
                      <div className="provider-header">
                        <div>
                          <h3>{provider.name}</h3>
                          <p className="subtle-text">{provider.id}</p>
                        </div>
                        <span
                          className={`status-pill ${
                            provider.connected ? 'status-pill-connected' : 'status-pill-idle'
                          }`}
                        >
                          {getConnectionLabel(provider)}
                        </span>
                      </div>

                      <div className="model-list">
                        {provider.models.map((model) => (
                          <span className="model-pill" key={model.id}>
                            {model.name}
                          </span>
                        ))}
                      </div>

                      <div className="button-row">
                        <button
                          className="button button-primary"
                          disabled={isBusy || !provider.hasOAuth}
                          onClick={() => {
                            void handleLogin(provider.id);
                          }}
                          type="button"
                        >
                          {isBusy ? 'Working…' : 'Connect'}
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={isBusy || !provider.connected}
                          onClick={() => {
                            void handleLogout(provider.id);
                          }}
                          type="button"
                        >
                          Disconnect
                        </button>
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>

            <section className="dev-section">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Events</p>
                  <h2>Auth log</h2>
                </div>
              </div>

              <div className="activity-list">
                {orderedEvents.length > 0 ? (
                  orderedEvents.map((event, index) => (
                    <article className="activity-item" key={`${event.timestamp}-${index}`}>
                      <div className="activity-header">
                        <span className={`event-dot event-${event.level}`} />
                        <strong>{event.providerId}</strong>
                        <span className="subtle-text">{formatTimestamp(event.timestamp)}</span>
                      </div>
                      <p>{event.message}</p>
                      {event.url ? (
                        <a
                          className="inline-link"
                          href={event.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {event.url}
                        </a>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No auth events yet.</p>
                )}
              </div>

              <code className="path-chip">
                {authOverview?.authFilePath ?? 'Loading auth file path...'}
              </code>
            </section>
          </details>
        </aside>

        <section className="chat-pane card">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Conversation</p>
              <h2>{sessionDetail?.session.title ?? 'Loading conversation...'}</h2>
            </div>
            <span className="subtle-text">
              {sessionDetail ? `${sessionDetail.session.messageCount} messages` : 'Loading...'}
            </span>
          </div>

          <div className="message-thread">
            {isBootstrapping || isLoadingSession ? (
              <div className="empty-thread">
                <p>Loading conversation…</p>
              </div>
            ) : renderedMessages.length > 0 ? (
              renderedMessages.map((message, index) => {
                const roleClass =
                  message.role === 'user'
                    ? 'message-user'
                    : message.role === 'assistant'
                      ? 'message-assistant'
                      : 'message-tool';
                const isPending = message.id.startsWith('pending-');

                return (
                  <article className={`message-row ${roleClass}`} key={`${message.id}-${index}`}>
                    <div className={`message-bubble ${isPending ? 'message-pending' : ''}`}>
                      <header className="message-meta">
                        <strong>
                          {message.role === 'user'
                            ? 'You'
                            : message.role === 'assistant'
                              ? 'Anvil'
                              : message.toolName || 'Tool'}
                        </strong>
                        <span className="subtle-text">{formatTimestamp(message.timestamp)}</span>
                      </header>
                      <p>{messageBody(message)}</p>
                      {message.stopReason ? (
                        <span className="message-stop-reason">{message.stopReason}</span>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-thread">
                <p>No messages yet. Start the conversation below.</p>
              </div>
            )}
          </div>

          <div className="composer">
            <textarea
              className="text-area composer-input"
              disabled={!connectedProvider || !activeModel || !activeSessionId || isSendingMessage}
              placeholder={
                connectedProvider && activeModel
                  ? 'Ask Anvil to inspect the repo, explain code, or plan a change…'
                  : 'Connect OpenAI Codex in Developer tools to start chatting.'
              }
              value={composerText}
              onChange={(event) => {
                setComposerText(event.target.value);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSendMessage();
                }
              }}
            />
            <div className="composer-footer">
              <span className="subtle-text">⌘/Ctrl + Enter to send</span>
              <button
                className="button button-primary"
                disabled={
                  !connectedProvider ||
                  !activeModel ||
                  !activeSessionId ||
                  composerText.trim().length === 0 ||
                  isSendingMessage
                }
                onClick={() => {
                  void handleSendMessage();
                }}
                type="button"
              >
                {isSendingMessage ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

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
    return 'Connected';
  }

  if (provider.connectionKind === 'api_key') {
    return 'Connected via key';
  }

  return 'Connected';
};

const getWorkspaceName = (workspacePath: string): string => {
  const segments = workspacePath.replaceAll('\\', '/').split('/').filter(Boolean);
  return segments.at(-1) ?? workspacePath;
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

const messageLabel = (message: ConversationMessage): string => {
  if (message.role === 'user') {
    return 'You';
  }

  if (message.role === 'assistant') {
    return 'Anvil';
  }

  return message.toolName || 'Tool';
};

const messageAvatar = (message: ConversationMessage): string => {
  if (message.role === 'user') {
    return 'Y';
  }

  if (message.role === 'assistant') {
    return 'A';
  }

  return 'T';
};

const findRetryPrompt = (messages: ConversationMessage[], index: number): string | null => {
  for (let currentIndex = index; currentIndex >= 0; currentIndex -= 1) {
    const candidate = messages[currentIndex];
    if (candidate?.role === 'user') {
      const prompt = candidate.text.trim();
      return prompt.length > 0 ? prompt : null;
    }
  }

  return null;
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  textarea.select();

  const didCopy = document.execCommand('copy');
  textarea.remove();
  return didCopy;
};

const createPendingRequest = (): { requestId: string; timestamp: number } => {
  const requestId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    requestId,
    timestamp: Date.now(),
  };
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
  const [pendingPrompt, setPendingPrompt] = useState<{
    requestId: string;
    text: string;
    timestamp: number;
  } | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<ConversationMessage | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const pendingRequestIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousSessionIdRef = useRef<string | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);

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

    const offChatStream = window.anvil.onChatStream((event) => {
      if (event.requestId !== pendingRequestIdRef.current) {
        return;
      }

      setStreamingAssistant(
        event.message.text.trim().length > 0
          ? event.message
          : { ...event.message, text: 'Thinking…' },
      );
    });

    return () => {
      cancelled = true;
      offProgress();
      offPrompt();
      offChatStream();
    };
  }, []);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = '0px';
    const nextHeight = Math.min(Math.max(composer.scrollHeight, 56), 220);
    composer.style.height = `${nextHeight}px`;
    composer.style.overflowY = composer.scrollHeight > 220 ? 'auto' : 'hidden';
  }, [composerText]);

  useEffect(
    () => () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    },
    [],
  );

  const connectedProvider = useMemo(
    () =>
      authOverview?.providers.find(
        (provider) => provider.connected && provider.models.length > 0,
      ) ?? null,
    [authOverview],
  );
  const activeModel = connectedProvider?.models[0] ?? null;
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
      streamingAssistant ?? {
        id: 'pending-assistant',
        role: 'assistant' as const,
        stopReason: 'stop' as const,
        text: 'Thinking…',
        timestamp: pendingPrompt.timestamp,
      },
    ];
  }, [pendingPrompt, sessionDetail, streamingAssistant]);

  useEffect(() => {
    const sessionChanged = previousSessionIdRef.current !== activeSessionId;
    previousSessionIdRef.current = activeSessionId;

    if (!threadEndRef.current) {
      return;
    }

    if (sessionChanged || shouldStickToBottomRef.current) {
      threadEndRef.current.scrollIntoView({ block: 'end' });
    }
  }, [activeSessionId, isBootstrapping, isLoadingSession, renderedMessages]);

  const workspacePath = authOverview?.workspacePath ?? window.anvil.workspacePath;
  const workspaceName = getWorkspaceName(workspacePath);
  const canChat = Boolean(connectedProvider && activeModel && activeSessionId);

  const handleThreadScroll = (): void => {
    const thread = threadRef.current;
    if (!thread) {
      return;
    }

    const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;
  };

  const loadSession = async (sessionId: string): Promise<void> => {
    setIsLoadingSession(true);
    setChatError(null);
    setPendingPrompt(null);
    setStreamingAssistant(null);
    pendingRequestIdRef.current = null;
    shouldStickToBottomRef.current = true;

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
    setPendingPrompt(null);
    setStreamingAssistant(null);
    pendingRequestIdRef.current = null;
    shouldStickToBottomRef.current = true;

    try {
      const created = await window.anvil.createSession();
      setActiveSessionId(created.detail.session.id);
      setSessionDetail(created.detail);
      setSessions((current) => upsertSession(current, created.detail.session));
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSelectWorkspace = async (): Promise<void> => {
    setIsSwitchingWorkspace(true);
    setChatError(null);

    try {
      const result = await window.anvil.selectWorkspace();
      if (result.canceled || !result.overview || !result.sessions || !result.detail) {
        return;
      }

      setAuthOverview(result.overview);
      setSessions(result.sessions);
      setActiveSessionId(result.detail.session.id);
      setSessionDetail(result.detail);
      setComposerText('');
      setPendingPrompt(null);
      setStreamingAssistant(null);
      pendingRequestIdRef.current = null;
      shouldStickToBottomRef.current = true;
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSwitchingWorkspace(false);
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

  const sendPrompt = async (
    promptText: string,
    options: { clearComposer: boolean; restoreComposerOnError: boolean },
  ): Promise<void> => {
    if (!connectedProvider || !activeModel || !activeSessionId || isSendingMessage) {
      return;
    }

    const prompt = promptText.trim();
    if (prompt.length === 0) {
      return;
    }

    const { requestId, timestamp } = createPendingRequest();

    pendingRequestIdRef.current = requestId;
    if (options.clearComposer) {
      setComposerText('');
    }
    setPendingPrompt({ requestId, text: prompt, timestamp });
    setStreamingAssistant({
      id: `stream-${requestId}`,
      role: 'assistant',
      stopReason: 'stop',
      text: 'Thinking…',
      timestamp,
    });
    setIsSendingMessage(true);
    setChatError(null);
    shouldStickToBottomRef.current = true;

    try {
      const result = await window.anvil.sendMessage({
        modelId: activeModel.id,
        prompt,
        providerId: connectedProvider.id,
        requestId,
        sessionId: activeSessionId,
      });

      if (!result.ok || !result.detail) {
        throw new Error(result.error || 'Message send failed.');
      }

      const detail = result.detail;
      setSessionDetail(detail);
      setSessions((current) => upsertSession(current, detail.session));
      setActiveSessionId(detail.session.id);
    } catch (error) {
      if (options.restoreComposerOnError) {
        setComposerText(prompt);
      }
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingRequestIdRef.current = null;
      setPendingPrompt(null);
      setStreamingAssistant(null);
      setIsSendingMessage(false);
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    await sendPrompt(composerText, {
      clearComposer: true,
      restoreComposerOnError: true,
    });
  };

  const handleRetryMessage = async (prompt: string): Promise<void> => {
    await sendPrompt(prompt, {
      clearComposer: false,
      restoreComposerOnError: false,
    });
  };

  const handleCopyMessage = async (messageId: string, text: string): Promise<void> => {
    const didCopy = await copyTextToClipboard(text);
    if (!didCopy) {
      return;
    }

    setCopiedMessageId(messageId);
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedMessageId((current) => (current === messageId ? null : current));
    }, 1600);
  };

  return (
    <main className="shell-root">
      {authPrompt ? (
        <section className="modal-overlay">
          <div className="prompt-modal">
            <div className="modal-header">
              <div>
                <p className="modal-kicker">Authorization required</p>
                <h2>{authPrompt.providerId}</h2>
              </div>
            </div>

            <p className="modal-copy">{authPrompt.message}</p>

            <label className="input-label" htmlFor="auth-prompt-input">
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
                className="button button-ghost"
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

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div className="brand-copy">
            <strong>Anvil</strong>
            <span>Personal desktop coding agent</span>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="topbar-caption" title={workspacePath}>
            {workspacePath}
          </span>
        </div>
      </header>

      {lastAuthResult ? (
        <section className={`notice ${lastAuthResult.ok ? 'notice-success' : 'notice-error'}`}>
          <strong>{lastAuthResult.message}</strong>
          {lastAuthResult.error ? <span>{lastAuthResult.error}</span> : null}
        </section>
      ) : null}

      {chatError ? (
        <section className="notice notice-error">
          <strong>Chat error</strong>
          <span>{chatError}</span>
        </section>
      ) : null}

      <section className="app-layout">
        <aside className="sidebar">
          <button
            className="new-chat-button"
            onClick={() => {
              void handleCreateSession();
            }}
            type="button"
          >
            <span className="new-chat-plus">+</span>
            <span>New chat</span>
          </button>

          <div className="sidebar-section-heading">Chats</div>

          <div className="session-list">
            {sessions.map((session) => (
              <button
                className={`session-item ${session.id === activeSessionId ? 'session-item-active' : ''}`}
                key={session.id}
                onClick={() => {
                  void loadSession(session.id);
                }}
                title={session.title}
                type="button"
              >
                <span className="session-title">{session.title}</span>
                <span className="session-meta">
                  {session.messageCount} messages · {formatUpdatedAt(session.updatedAt)}
                </span>
              </button>
            ))}
          </div>

          <details className="dev-panel">
            <summary>Developer tools</summary>

            <section className="dev-panel-section">
              <div className="dev-panel-heading">
                <span>Connections</span>
              </div>

              <div className="provider-list">
                {authOverview?.providers.map((provider) => {
                  const isBusy = busyProviderId === provider.id;

                  return (
                    <section className="provider-card" key={provider.id}>
                      <div className="provider-row">
                        <div>
                          <h3>{provider.name}</h3>
                          <p className="provider-subtitle">{provider.id}</p>
                        </div>
                        <span
                          className={`toolbar-chip ${
                            provider.connected ? 'toolbar-chip-success' : 'toolbar-chip-muted'
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
                          className="button button-ghost"
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

            <section className="dev-panel-section">
              <div className="dev-panel-heading">
                <span>Auth log</span>
              </div>

              <div className="activity-list">
                {events.length > 0 ? (
                  events.map((event, index) => (
                    <article className="activity-item" key={`${event.timestamp}-${index}`}>
                      <div className="activity-header">
                        <span className={`event-dot event-${event.level}`} />
                        <strong>{event.providerId}</strong>
                        <span className="activity-time">{formatTimestamp(event.timestamp)}</span>
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
                  <p className="empty-copy">No auth events yet.</p>
                )}
              </div>

              <div className="dev-panel-footnote">
                <span>Auth file</span>
                <code>{authOverview?.authFilePath ?? 'Loading auth file path...'}</code>
              </div>
            </section>
          </details>
        </aside>

        <section className="chat-shell">
          <header className="chat-shell-header">
            <div className="chat-shell-heading">
              <p className="chat-shell-kicker">Conversation</p>
              <h1 className="chat-shell-title" title={sessionDetail?.session.title}>
                {sessionDetail?.session.title ?? 'Loading conversation…'}
              </h1>
              <p className="chat-shell-subtitle">
                {sessionDetail ? `${sessionDetail.session.messageCount} messages` : 'Loading…'}
              </p>
            </div>

            <div className="chat-context">
              <div className="chat-context-row">
                <span className="toolbar-chip toolbar-chip-muted" title={workspacePath}>
                  {workspaceName}
                </span>
                <span
                  className={`toolbar-chip ${
                    connectedProvider && activeModel ? 'toolbar-chip-success' : 'toolbar-chip-muted'
                  }`}
                >
                  {connectedProvider && activeModel
                    ? `${connectedProvider.name} · ${activeModel.name}`
                    : 'Connect OpenAI Codex'}
                </span>
              </div>
              <button
                className="button button-ghost button-compact"
                disabled={isSwitchingWorkspace}
                onClick={() => {
                  void handleSelectWorkspace();
                }}
                type="button"
              >
                {isSwitchingWorkspace ? 'Switching…' : 'Switch repo'}
              </button>
            </div>
          </header>

          <div className="message-thread" onScroll={handleThreadScroll} ref={threadRef}>
            <div className="thread-stack">
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
                  const body = messageBody(message);
                  const isErrorMessage = message.isError || message.stopReason === 'error';
                  const retryPrompt = findRetryPrompt(renderedMessages, index);
                  const canRetry =
                    Boolean(retryPrompt && connectedProvider && activeModel && activeSessionId) &&
                    !isPending &&
                    !isSendingMessage;
                  const canCopy = body.trim().length > 0 && !isPending;
                  const bubbleClassName = [
                    'message-bubble',
                    isPending ? 'message-pending' : '',
                    isErrorMessage ? 'message-error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <article className={`message-row ${roleClass}`} key={`${message.id}-${index}`}>
                      <div className={`message-avatar ${roleClass}`}>{messageAvatar(message)}</div>
                      <div className={bubbleClassName}>
                        <header className="message-meta">
                          <strong>{messageLabel(message)}</strong>
                          <div className="message-meta-actions">
                            <span className="message-time">
                              {formatTimestamp(message.timestamp)}
                            </span>
                            {message.role !== 'user' ? (
                              <>
                                <button
                                  className={`message-utility-button ${
                                    copiedMessageId === message.id
                                      ? 'message-utility-button-active'
                                      : ''
                                  }`}
                                  disabled={!canCopy}
                                  onClick={() => {
                                    void handleCopyMessage(message.id, body);
                                  }}
                                  type="button"
                                >
                                  {copiedMessageId === message.id ? 'Copied' : 'Copy'}
                                </button>
                                {retryPrompt ? (
                                  <button
                                    className="message-utility-button"
                                    disabled={!canRetry}
                                    onClick={() => {
                                      void handleRetryMessage(retryPrompt);
                                    }}
                                    type="button"
                                  >
                                    Retry
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </header>
                        <p className="message-content">{body}</p>
                        {message.stopReason ? (
                          <span className="message-stop-reason">{message.stopReason}</span>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="empty-thread empty-thread-large">
                  <div>
                    <h2>How can I help?</h2>
                    <p>Ask Anvil to inspect the repo, explain code, or plan a change.</p>
                  </div>
                </div>
              )}
              <div className="thread-endcap" ref={threadEndRef} />
            </div>
          </div>

          <footer className="composer-shell">
            <div className="composer-surface">
              <textarea
                className="composer-input"
                disabled={!canChat || isSendingMessage}
                placeholder={
                  connectedProvider && activeModel
                    ? 'Message Anvil…'
                    : 'Connect OpenAI Codex in Developer tools to start chatting.'
                }
                ref={composerRef}
                rows={1}
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
              <div className="composer-toolbar">
                <span className="composer-hint">⌘/Ctrl + Enter to send</span>
                <button
                  className="button button-primary composer-send"
                  disabled={!canChat || composerText.trim().length === 0 || isSendingMessage}
                  onClick={() => {
                    void handleSendMessage();
                  }}
                  type="button"
                >
                  {isSendingMessage ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </footer>
        </section>
      </section>
    </main>
  );
}

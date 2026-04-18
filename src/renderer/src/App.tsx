import { useEffect, useMemo, useState } from 'react';

import type {
  AuthActionResult,
  AuthOverview,
  AuthProgressEvent,
  AuthPromptRequest,
  AuthProviderSummary,
} from '../../shared/anvil-api';

const formatTimestamp = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);

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

export default function App() {
  const [authOverview, setAuthOverview] = useState<AuthOverview | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptRequest | null>(null);
  const [authPromptValue, setAuthPromptValue] = useState('');
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [events, setEvents] = useState<AuthProgressEvent[]>([]);
  const [lastResult, setLastResult] = useState<AuthActionResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadOverview = async (): Promise<void> => {
      const overview = await window.anvil.getAuthOverview();
      if (!cancelled) {
        setAuthOverview(overview);
      }
    };

    void loadOverview();

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

  const orderedEvents = useMemo(() => events, [events]);

  const handleLogin = async (providerId: string): Promise<void> => {
    setBusyProviderId(providerId);
    setLastResult(null);

    try {
      const result = await window.anvil.login(providerId);
      setLastResult(result);
      setAuthOverview(result.overview);
    } finally {
      setAuthPrompt(null);
      setAuthPromptValue('');
      setBusyProviderId(null);
    }
  };

  const handleLogout = async (providerId: string): Promise<void> => {
    setBusyProviderId(providerId);
    setLastResult(null);

    try {
      const result = await window.anvil.logout(providerId);
      setLastResult(result);
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

  return (
    <main className="app-shell">
      <section className="hero card">
        <div className="hero-copy">
          <p className="eyebrow">forjd / anvil</p>
          <h1>Auth workbench</h1>
          <p className="lead">
            A minimal frontend for iterating on the local OAuth flow before the full coding-agent UI
            exists.
          </p>
        </div>

        <div className="hero-meta">
          <div>
            <span className="meta-label">Platform</span>
            <strong>{window.anvil.platform}</strong>
          </div>
          <div>
            <span className="meta-label">Electron</span>
            <strong>{window.anvil.versions.electron}</strong>
          </div>
          <div>
            <span className="meta-label">Node</span>
            <strong>{window.anvil.versions.node}</strong>
          </div>
        </div>
      </section>

      {lastResult ? (
        <section className={`banner ${lastResult.ok ? 'banner-success' : 'banner-error'}`}>
          <strong>{lastResult.message}</strong>
          {lastResult.error ? <span>{lastResult.error}</span> : null}
        </section>
      ) : null}

      {authPrompt ? (
        <section className="card prompt-card">
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
        </section>
      ) : null}

      <section className="grid auth-grid">
        <article className="card providers-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Providers</p>
              <h2>Available auth targets</h2>
            </div>
            <span className="subtle-text">
              {authOverview ? `${authOverview.providers.length} configured provider` : 'Loading...'}
              {authOverview?.providers.length === 1 ? '' : 's'}
            </span>
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

                  <div className="provider-meta">
                    <div>
                      <span className="meta-label">Auth</span>
                      <strong>{provider.hasOAuth ? 'OAuth available' : 'No OAuth flow'}</strong>
                    </div>
                    <div>
                      <span className="meta-label">Models</span>
                      <strong>{provider.models.length}</strong>
                    </div>
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
        </article>

        <article className="card activity-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Auth event stream</h2>
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
                    <a className="inline-link" href={event.url} rel="noreferrer" target="_blank">
                      {event.url}
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="empty-state">No auth events yet. Try Connect to exercise the flow.</p>
            )}
          </div>
        </article>
      </section>

      <section className="card footer-card">
        <div>
          <p className="eyebrow">Storage</p>
          <h2>Local auth state</h2>
          <p className="subtle-text">
            Credentials are stored locally on disk. Right now the frontend is just enough to inspect
            providers, kick off login attempts, and handle prompt handoffs.
          </p>
        </div>
        <code className="path-chip">
          {authOverview?.authFilePath ?? 'Loading auth file path...'}
        </code>
      </section>
    </main>
  );
}

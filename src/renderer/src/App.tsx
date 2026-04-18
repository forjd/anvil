const goals = [
  'Shape the MVP around a desktop coding agent for local repos.',
  'Integrate Codex via app-server in a dedicated runtime process.',
  'Keep edits and command execution human-approved by default.',
];

const nextDocs = [
  'docs/plans/mvp-scope.md',
  'docs/plans/desktop-runtime.md',
  'docs/plans/approval-and-sandboxing.md',
];

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero card">
        <p className="eyebrow">forjd / anvil</p>
        <h1>Anvil</h1>
        <p className="lead">
          A desktop coding agent for local repositories, with local execution and Codex-powered
          model calls.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Current focus</h2>
          <ul>
            {goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Next docs</h2>
          <ul>
            {nextDocs.map((doc) => (
              <li key={doc}>{doc}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="card meta-grid">
        <div>
          <h2>Runtime</h2>
          <p>Electron {window.anvil.versions.electron}</p>
        </div>
        <div>
          <h2>Node</h2>
          <p>{window.anvil.versions.node}</p>
        </div>
        <div>
          <h2>Platform</h2>
          <p>{window.anvil.platform}</p>
        </div>
      </section>
    </main>
  );
}

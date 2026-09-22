import { useEffect, useRef, useState } from 'react';
import { askQuestion, fetchContext, type ContextProject, type ContextUser, type Evidence, type TraceStep } from './api';

/** The answer text uses **bold** section headers; render those without pulling in a markdown library. */
function renderAnswer(text: string) {
  return text.split('\n\n').map((para, i) => {
    const parts = para.split(/\*\*(.+?)\*\*/g);
    return (
      <p key={i}>
        {parts.map((part, j) => (j % 2 === 1 ? <strong key={j}>{part}</strong> : part))}
      </p>
    );
  });
}

const FLAGSHIP_QUESTIONS = [
  'Is the Zone 3 contractor owed payment for the drywall milestone, and according to the contract, can the client withhold payment because inspection photos are missing?',
  'Does Meridian Development owe money for the Zone 3 drywall work, and is it allowed to hold back payment since there are no inspection photos?',
  "What's the payment status on the Zone 3 drywall milestone, and does Article 4.2 permit withholding it given the missing photos?",
];

export default function App() {
  const [users, setUsers] = useState<ContextUser[]>([]);
  const [projects, setProjects] = useState<ContextProject[]>([]);
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [question, setQuestion] = useState(FLAGSHIP_QUESTIONS[0]);

  const [asking, setAsking] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchContext()
      .then(({ users, projects }) => {
        setUsers(users);
        setProjects(projects);
        setUserId(users.find((u) => u.role === 'admin')?.id ?? users[0]?.id ?? '');
        setProjectId(projects.find((p) => p.name === 'Riverside Tower')?.id ?? projects[0]?.id ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load context'));

    return () => eventSourceRef.current?.close();
  }, []);

  function handleAsk() {
    if (!question.trim() || !userId || !projectId || asking) return;
    eventSourceRef.current?.close();

    setAsking(true);
    setTrace([]);
    setAnswer(null);
    setEvidence([]);
    setError(null);

    eventSourceRef.current = askQuestion(question, userId, projectId, {
      onStep: (step) => setTrace((prev) => [...prev, step]),
      onDone: (result) => {
        setAnswer(result.answer);
        setEvidence(result.evidence);
        setAsking(false);
        eventSourceRef.current?.close();
      },
      onError: (message) => {
        setError(message);
        setAsking(false);
        eventSourceRef.current?.close();
      },
    });
  }

  const selectedUser = users.find((u) => u.id === userId);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Construction Ops Assistant</h1>
        <p className="subtitle">One answer, three sources reconciled — payments, contract terms &amp; site progress</p>
      </header>

      <div className="controls">
        <label>
          User
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {selectedUser?.role === 'contractor' && (
          <span className="hint">Zone-restricted user — try a question about another zone to see access control block it.</span>
        )}
      </div>

      <div className="question-row">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="Ask a question…"
        />
        <button onClick={handleAsk} disabled={asking}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>

      <div className="quick-select">
        {FLAGSHIP_QUESTIONS.map((q) => (
          <button key={q} className="chip" onClick={() => setQuestion(q)} disabled={asking}>
            {q.length > 50 ? q.slice(0, 50) + '…' : q}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panes">
        <main className="answer-pane">
          <h2>Answer</h2>
          {!answer && !asking && <p className="empty">Ask a question to see the answer here.</p>}
          {asking && !answer && <p className="empty">Working…</p>}
          {answer && <div className="answer-text">{renderAnswer(answer)}</div>}

          {evidence.length > 0 && (
            <>
              <h3>Evidence</h3>
              <ul className="evidence-list">
                {evidence.map((e) => (
                  <li key={e.sourceId}>
                    <span className="evidence-tag">{e.sourceType}</span> {e.content}
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>

        <aside className="trace-pane">
          <h2>Trace</h2>
          {trace.length === 0 && <p className="empty">No activity yet.</p>}
          <ol className="trace-list">
            {trace.map((step, i) => (
              <li key={i}>
                <span className="trace-agent">[{step.agent}]</span> {step.message}
                {typeof step.latencyMs === 'number' && <span className="trace-latency"> · {step.latencyMs}ms</span>}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

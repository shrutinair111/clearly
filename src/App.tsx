import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { groupTripAnswer } from "./mockAnswer";
import type { Answer } from "./mockAnswer";

type Mode = "Skim" | "Study" | "Quiet";
// writing = the answer is still appearing, paused = writing on hold,
// stopped = the user ended it early, done = the full answer is here
type Status = "writing" | "paused" | "stopped" | "done";

const MODES: Mode[] = ["Skim", "Study", "Quiet"];
const MODE_DESCRIPTIONS: Record<Mode, string> = {
  Skim: "Summary first, then step titles. Option D for details.",
  Study: "Each step read in full, one at a time.",
  Quiet: "Only tells you when an answer is ready.",
};

// How long each mock step takes to "write", in milliseconds.
// Later, real AI streaming replaces this timer.
const STEP_DELAY = 1200;

type ShortcutRow = { keys: string; spoken: string; label: string };

export default function App() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [status, setStatus] = useState<Status>("done");
  const [written, setWritten] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [mode, setMode] = useState<Mode>("Skim");
  const [toast, setToast] = useState<Mode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const toastTimer = useRef<number | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const total = answer?.steps.length ?? 0;
  const isGenerating = status === "writing" || status === "paused";
  const canNavigate = answer !== null && !isGenerating && written > 0;

  function announce(message: string) {
    setAnnouncement("");
    setTimeout(() => setAnnouncement(message), 100);
  }

  // ---------- Modes ----------
  function cycleMode() {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    const after = MODES[(MODES.indexOf(next) + 1) % MODES.length];
    setMode(next);
    setToast(next);
    announce(`Mode: ${next}. ${MODE_DESCRIPTIONS[next]} Press Option M for ${after}.`);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }

  // ---------- Asking a question ----------
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsked(question);
    setAnswer(groupTripAnswer);
    setWritten(0);
    setStatus("writing");
    setActiveStep(0);
    setShowDetails(false);
    setQuestion("");
    announce(
      mode === "Quiet"
        ? "Generating."
        : mode === "Study"
          ? "Generating answer. I'll tell you as each step is ready."
          : "Generating answer."
    );
  }

  // ---------- Streaming: steps appear one at a time ----------
  useEffect(() => {
    if (!answer || status !== "writing") return;

    const timer = window.setTimeout(() => {
      const count = answer.steps.length;
      const next = written + 1;
      const say = (message: string) => {
        setAnnouncement("");
        window.setTimeout(() => setAnnouncement(message), 100);
      };
      setWritten(next);

      if (next < count) {
        // Study mode hears each step as soon as it's ready
        if (mode === "Study") {
          say(`Step ${next} of ${count} ready: ${answer.steps[next - 1].title}.`);
        }
        return;
      }

      // The whole answer is here
      setStatus("done");
      setActiveStep(0);
      setShowDetails(false);
      if (mode === "Study") {
        window.setTimeout(() => stepRefs.current[0]?.focus(), 50);
      } else if (mode === "Quiet") {
        window.setTimeout(() => titleRef.current?.focus(), 50);
        say(`Answer complete. ${count} steps.`);
      } else {
        window.setTimeout(() => titleRef.current?.focus(), 50);
        say(
          `Answer ready. ${count} steps. Summary: ${answer.summary} Press Option D to hear step 1, or Option N for the next step.`
        );
      }
    }, STEP_DELAY);

    return () => window.clearTimeout(timer);
  }, [answer, status, written, mode]);

  // Skim mode: a gentle "still working" if writing takes a while
  useEffect(() => {
    if (status !== "writing" || mode !== "Skim") return;
    const timer = window.setTimeout(() => {
      setAnnouncement("");
      window.setTimeout(() => setAnnouncement("Still working."), 100);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [status, mode]);

  function pauseOrResume() {
    if (status === "writing") {
      setStatus("paused");
      announce(`Paused. ${written} of ${total} steps written. Press Option P to resume.`);
    } else if (status === "paused") {
      setStatus("writing");
      announce("Resumed.");
    }
  }

  function stopGenerating() {
    if (!isGenerating) return;
    setStatus("stopped");
    setActiveStep(0);
    setShowDetails(false);
    setTimeout(() => titleRef.current?.focus(), 0);
    const tip = mode === "Quiet" ? "" : " Press Option D to hear step 1.";
    announce(
      written > 0
        ? `Stopped. ${written} of ${total} steps were written.${tip}`
        : "Stopped before any steps were written."
    );
  }

  // ---------- Moving through steps ----------
  function goToStep(index: number, withDetails = false) {
    setActiveStep(index);
    setShowDetails(withDetails);
    setTimeout(() => stepRefs.current[index]?.focus(), 0);
  }

  function nextStep() {
    if (!canNavigate) return;
    if (activeStep >= written - 1) {
      announce(
        mode === "Quiet"
          ? "End of answer."
          : `That's all ${written} steps. Press Option R to hear the summary again, or ask a new question.`
      );
      return;
    }
    goToStep(activeStep + 1);
  }

  function previousStep() {
    if (!canNavigate) return;
    if (activeStep === 0) {
      announce("This is the first step.");
      return;
    }
    goToStep(activeStep - 1);
  }

  function hearDetails() {
    if (!canNavigate) return;
    goToStep(activeStep, true);
  }

  function repeatSummary() {
    if (!answer) return;
    if (status !== "done") {
      announce("The summary hasn't been written yet.");
      return;
    }
    titleRef.current?.focus();
    announce(`Summary: ${answer.summary}`);
  }

  // ---------- Shortcuts panel ----------
  function openPanel() {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setPanelOpen(true);
    setTimeout(() => panelHeadingRef.current?.focus(), 0);
  }

  function closePanel() {
    setPanelOpen(false);
    setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const typing = document.activeElement === inputRef.current;

      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "?" && !typing) {
        e.preventDefault();
        togglePanel();
        return;
      }
      if (e.key === "Escape") {
        if (isGenerating) { e.preventDefault(); stopGenerating(); }
        else if (panelOpen) { e.preventDefault(); closePanel(); }
        return;
      }

      if (!e.altKey) return;

      if (e.code === "KeyM") { e.preventDefault(); cycleMode(); return; }
      if (e.code === "KeyP") { e.preventDefault(); pauseOrResume(); return; }
      if (!canNavigate) return;

      if (e.code === "KeyN") { e.preventDefault(); nextStep(); }
      else if (e.code === "KeyB") { e.preventDefault(); previousStep(); }
      else if (e.code === "KeyD") { e.preventDefault(); hearDetails(); }
      else if (e.code === "KeyR") { e.preventDefault(); repeatSummary(); }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  // ---------- Text for the status pill ----------
  const statusText =
    status === "writing" ? `Writing step ${written + 1} of ${total}…`
    : status === "paused" ? `Paused · ${written} of ${total} steps written`
    : status === "stopped" ? `Stopped · ${written} of ${total} steps`
    : `Answer ready · ${total} steps`;

  // ---------- Shortcut groups for the panel ----------
  const groups: { name: string; useful: boolean; rows: ShortcutRow[] }[] = [
    {
      name: "Moving through an answer",
      useful: canNavigate,
      rows: [
        { keys: "⌥N", spoken: "Option N", label: "Next step" },
        { keys: "⌥B", spoken: "Option B", label: "Previous step" },
        { keys: "⌥D", spoken: "Option D", label: "Details" },
        { keys: "⌥R", spoken: "Option R", label: "Repeat summary" },
      ],
    },
    {
      name: "While an answer is being written",
      useful: isGenerating,
      rows: [
        { keys: "⌥P", spoken: "Option P", label: "Pause or resume" },
        { keys: "Esc", spoken: "Escape", label: "Stop" },
      ],
    },
    {
      name: "Anytime",
      useful: !canNavigate && !isGenerating,
      rows: [
        { keys: "⌥M", spoken: "Option M", label: "Change mode" },
        { keys: "/", spoken: "Slash", label: "Type a question" },
        { keys: "?", spoken: "Question mark", label: "Show or hide this panel" },
      ],
    },
  ];

  // ---------- What's on screen ----------
  return (
    <div className="app">
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className="top-bar">
        <div className="wordmark">
          <span className="dot" aria-hidden="true" />
          Clearly
        </div>
      </header>

      <div className="layout">
        <main className="conversation">
          {answer === null ? (
            <>
              <h1>What would you like to know?</h1>
              <p className="muted">
                Answers are read in {mode} mode. Press ? anytime for shortcuts.
              </p>
            </>
          ) : (
            <section className="answer" aria-labelledby="answer-title">
              <p className="user-message">
                <span className="visually-hidden">You asked: </span>
                {asked}
              </p>

              <p className="status">
                <span className={`status-dot ${status}`} aria-hidden="true" />
                {statusText}
              </p>

              <h1 id="answer-title" ref={titleRef} tabIndex={-1}>
                {answer.title}
              </h1>

              {status === "done" && (
                <div className="summary">
                  <p className="summary-label">Summary</p>
                  <p>{answer.summary}</p>
                </div>
              )}

              <ol className="steps">
                {answer.steps.slice(0, written).map((step, i) => {
                  const isActive = canNavigate && i === activeStep;
                  const showBody = isActive && (mode === "Study" || showDetails);
                  return (
                    <li
                      key={i}
                      ref={(el) => { stepRefs.current[i] = el; }}
                      tabIndex={-1}
                      className={isActive ? "step active" : "step"}
                    >
                      <div className="step-header">
                        <span className="step-number" aria-hidden="true">
                          {i + 1}
                        </span>
                        <h2 className="step-title">
                          <span className="visually-hidden">
                            Step {i + 1} of {total}:{" "}
                          </span>
                          {step.title}
                        </h2>
                        {isActive && <span className="now-tag">Now reading</span>}
                      </div>
                      {showBody && <p className="step-body">{step.body}</p>}
                    </li>
                  );
                })}
              </ol>

              {isGenerating && (
                <div className="step-writing" aria-hidden="true">
                  <div className="step-header">
                    <span className="step-number writing">{written + 1}</span>
                    <span className="writing-label">
                      {status === "paused" ? "Paused" : "Writing…"}
                    </span>
                  </div>
                  <span className="writing-line" />
                  <span className="writing-line short" />
                </div>
              )}

              <div className="shortcut-bar">
                {isGenerating ? (
                  <>
                    <button
                      type="button"
                      className="shortcut"
                      onClick={pauseOrResume}
                      aria-keyshortcuts="Alt+P"
                    >
                      <kbd aria-hidden="true">⌥P</kbd>{" "}
                      {status === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button
                      type="button"
                      className="shortcut"
                      onClick={stopGenerating}
                      aria-keyshortcuts="Escape"
                    >
                      <kbd aria-hidden="true">Esc</kbd> Stop
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="shortcut"
                      onClick={previousStep}
                      aria-keyshortcuts="Alt+B"
                    >
                      <kbd aria-hidden="true">⌥B</kbd> Previous
                    </button>
                    <button
                      type="button"
                      className="shortcut"
                      onClick={nextStep}
                      aria-keyshortcuts="Alt+N"
                    >
                      <kbd aria-hidden="true">⌥N</kbd> Next step
                    </button>
                    <button
                      type="button"
                      className="shortcut"
                      onClick={hearDetails}
                      aria-keyshortcuts="Alt+D"
                    >
                      <kbd aria-hidden="true">⌥D</kbd> Details
                    </button>
                    <button
                      type="button"
                      className="shortcut"
                      onClick={repeatSummary}
                      aria-keyshortcuts="Alt+R"
                    >
                      <kbd aria-hidden="true">⌥R</kbd> Repeat summary
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="shortcut"
                  onClick={togglePanel}
                  aria-keyshortcuts="Shift+/"
                  aria-expanded={panelOpen}
                >
                  <kbd aria-hidden="true">?</kbd> All shortcuts
                </button>
              </div>
            </section>
          )}

          <form className="composer" onSubmit={handleSubmit}>
            <label htmlFor="question" className="visually-hidden">
              Ask a question
            </label>
            <input
              id="question"
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              autoComplete="off"
            />
            <button type="submit" className="send">Send</button>
          </form>

          <div className="below-box">
            <button
              type="button"
              className="mode-chip"
              onClick={cycleMode}
              aria-label={`Mode: ${mode}. Press Option M to change.`}
            >
              Mode: {mode} <kbd>⌥M</kbd>
            </button>

            {toast && (
              <div className="toast" aria-hidden="true">
                <strong>Mode: {toast}</strong> {MODE_DESCRIPTIONS[toast]}
              </div>
            )}

            <p className="hint">Press / to jump here and type</p>
          </div>
        </main>

        {panelOpen && (
          <aside className="shortcuts-panel" aria-labelledby="shortcuts-title">
            <div className="panel-header">
              <h2 id="shortcuts-title" ref={panelHeadingRef} tabIndex={-1}>
                Shortcuts
              </h2>
              <button
                type="button"
                className="panel-close"
                onClick={closePanel}
                aria-keyshortcuts="Shift+/"
              >
                Close <kbd aria-hidden="true">?</kbd>
              </button>
            </div>
            <p className="panel-intro">
              Stays open while you listen. Press ? to close.
            </p>

            {groups.map((group) => (
              <section
                key={group.name}
                className={group.useful ? "shortcut-group useful" : "shortcut-group"}
              >
                <h3>
                  {group.useful && <span className="useful-tag">Useful now</span>}
                  {group.useful && <span className="visually-hidden">: </span>}
                  {group.name}
                </h3>
                <ul className="shortcut-list">
                  {group.rows.map((row) => (
                    <li key={row.label}>
                      <kbd aria-hidden="true">{row.keys}</kbd>
                      <span className="visually-hidden">{row.spoken}: </span>
                      {row.label}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

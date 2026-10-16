import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { groupTripAnswer } from "./mockAnswer";
import type { Answer } from "./mockAnswer";

type Mode = "Skim" | "Study" | "Quiet";
const MODES: Mode[] = ["Skim", "Study", "Quiet"];
const MODE_DESCRIPTIONS: Record<Mode, string> = {
  Skim: "Summary first, then step titles. Option D for details.",
  Study: "Each step read in full, one at a time.",
  Quiet: "Only tells you when an answer is ready.",
};

export default function App() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [mode, setMode] = useState<Mode>("Skim");
  const [toast, setToast] = useState<Mode | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const toastTimer = useRef<number | null>(null);

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
    const newAnswer = groupTripAnswer;
    const count = newAnswer.steps.length;
    setAsked(question);
    setAnswer(newAnswer);
    setActiveStep(0);
    setShowDetails(false);
    setQuestion("");

    if (mode === "Study") {
      // Go straight into step 1 and read it in full
      setTimeout(() => stepRefs.current[0]?.focus(), 0);
    } else if (mode === "Quiet") {
      setTimeout(() => titleRef.current?.focus(), 0);
      announce(`Answer complete. ${count} steps.`);
    } else {
      setTimeout(() => titleRef.current?.focus(), 0);
      announce(
        `Answer ready. Summary: ${newAnswer.summary} Press Option D to hear step 1, or Option N for the next step.`
      );
    }
  }

  // ---------- Moving through steps ----------
  function goToStep(index: number, withDetails = false) {
    setActiveStep(index);
    setShowDetails(withDetails);
    setTimeout(() => stepRefs.current[index]?.focus(), 0);
  }

  function nextStep() {
    if (!answer) return;
    if (activeStep >= answer.steps.length - 1) {
      announce(
        mode === "Quiet"
          ? "End of answer."
          : `That's all ${answer.steps.length} steps. Press Option R to hear the summary again, or ask a new question.`
      );
      return;
    }
    goToStep(activeStep + 1);
  }

  function previousStep() {
    if (activeStep === 0) {
      announce("This is the first step.");
      return;
    }
    goToStep(activeStep - 1);
  }

  function hearDetails() {
    goToStep(activeStep, true);
  }

  function repeatSummary() {
    if (!answer) return;
    titleRef.current?.focus();
    announce(`Summary: ${answer.summary}`);
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

      if (!e.altKey) return;

      if (e.code === "KeyM") { e.preventDefault(); cycleMode(); return; }
      if (!answer) return;

      if (e.code === "KeyN") { e.preventDefault(); nextStep(); }
      else if (e.code === "KeyB") { e.preventDefault(); previousStep(); }
      else if (e.code === "KeyD") { e.preventDefault(); hearDetails(); }
      else if (e.code === "KeyR") { e.preventDefault(); repeatSummary(); }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

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
            <p className="user-message">{asked}</p>

            <p className="status">
              <span className="status-dot" aria-hidden="true" />
              Answer ready · {answer.steps.length} steps
            </p>

            <h1 id="answer-title" ref={titleRef} tabIndex={-1}>
              {answer.title}
            </h1>

            <div className="summary">
              <p className="summary-label">Summary</p>
              <p>{answer.summary}</p>
            </div>

            <ol className="steps">
              {answer.steps.map((step, i) => {
                const isActive = i === activeStep;
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
                          Step {i + 1} of {answer.steps.length}:{" "}
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

            <div className="shortcut-bar">
              <button type="button" className="shortcut" onClick={previousStep}>
                <kbd>⌥B</kbd> Previous
              </button>
              <button type="button" className="shortcut" onClick={nextStep}>
                <kbd>⌥N</kbd> Next step
              </button>
              <button type="button" className="shortcut" onClick={hearDetails}>
                <kbd>⌥D</kbd> Details
              </button>
              <button type="button" className="shortcut" onClick={repeatSummary}>
                <kbd>⌥R</kbd> Repeat summary
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
    </div>
  );
}
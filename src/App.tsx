import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import type { Answer, Step } from "./mockAnswer";
import Onboarding from "./Onboarding";
import type { Mode } from "./Onboarding";
// writing = the answer is still arriving, paused = new steps held back,
// stopped = the user ended it early, done = the full answer is here,
// error = something went wrong before it finished
type Status = "writing" | "paused" | "stopped" | "done" | "error";

// Reads one line of Gemini's answer, like "STEP: Pick a place | Narrow it down…".
// Returns what kind of line it is, or null if it's not one we recognize.
type Parsed =
  | { kind: "title"; text: string }
  | { kind: "summary"; text: string }
  | { kind: "step"; step: Step };

function parseLine(line: string): Parsed | null {
  const match = line.match(/^[\s*#>-]*(TITLE|STEP|SUMMARY)\s*\**\s*:\s*\**\s*(.*)$/i);
  if (!match) return null;
  const kind = match[1].toUpperCase();
  const text = match[2].replace(/\*\*/g, "").trim();
  if (!text) return null;
  if (kind === "TITLE") return { kind: "title", text };
  if (kind === "SUMMARY") return { kind: "summary", text };
  const divider = text.indexOf("|");
  if (divider === -1) return { kind: "step", step: { title: text, body: "" } };
  return {
    kind: "step",
    step: {
      title: text.slice(0, divider).trim(),
      body: text.slice(divider + 1).trim(),
    },
  };
}

const MODES: Mode[] = ["Skim", "Study", "Quiet"];
const MODE_DESCRIPTIONS: Record<Mode, string> = {
  Skim: "Summary first, then step titles. Option D for details.",
  Study: "Each step read in full, one at a time.",
  Quiet: "Only tells you when an answer is ready.",
};

type ShortcutRow = { keys: string; spoken: string; label: string };

// Remember setup between visits (in this browser only)
function loadSaved(): { onboarded: boolean; mode: Mode } {
  try {
    const saved = localStorage.getItem("clearly-mode");
    return {
      onboarded: localStorage.getItem("clearly-onboarded") === "yes",
      mode: saved === "Study" || saved === "Quiet" ? saved : "Skim",
    };
  } catch {
    return { onboarded: false, mode: "Skim" };
  }
}

function saveSetup(mode: Mode) {
  try {
    localStorage.setItem("clearly-mode", mode);
    localStorage.setItem("clearly-onboarded", "yes");
  } catch {
    // Storage can be unavailable (for example in private browsing); that's fine
  }
}

export default function App() {
  const [saved] = useState(loadSaved);
  const [onboarded, setOnboarded] = useState(saved.onboarded);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [status, setStatus] = useState<Status>("done");
  const [written, setWritten] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [toast, setToast] = useState<Mode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const headingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
  const bodyRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const toastTimer = useRef<number | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // These "refs" let the streaming code see the latest values while it runs
  const modeRef = useRef<Mode>(saved.mode);
  const stepsRef = useRef<Step[]>([]);
  const pausedRef = useRef(false);
  const finishWaitingRef = useRef(false);
  const summaryRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

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
    modeRef.current = next;
    saveSetup(next);
    setToast(next);
    announce(`Mode: ${next}. ${MODE_DESCRIPTIONS[next]} Press Option M for ${after}.`);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }

  // ---------- Asking a question ----------
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    abortRef.current?.abort(); // stop any answer still arriving
    setAsked(q);
    setAnswer({ title: "", summary: "", steps: [] });
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
    void streamAnswer(q);
  }

  // ---------- Streaming: the real answer arrives from Gemini ----------
  async function streamAnswer(q: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    stepsRef.current = [];
    pausedRef.current = false;
    finishWaitingRef.current = false;
    summaryRef.current = "";
    let rawText = "";

    // Called once for every complete line of the answer
    const handleLine = (line: string) => {
      const parsed = parseLine(line);
      if (!parsed) return;
      if (parsed.kind === "title") {
        setAnswer((a) => (a ? { ...a, title: parsed.text } : a));
      } else if (parsed.kind === "summary") {
        summaryRef.current = parsed.text;
        setAnswer((a) => (a ? { ...a, summary: parsed.text } : a));
      } else {
        // A step is finished: this is the "section boundary" Clearly listens for
        stepsRef.current = [...stepsRef.current, parsed.step];
        const steps = stepsRef.current;
        setAnswer((a) => (a ? { ...a, steps } : a));
        if (!pausedRef.current) {
          setWritten(steps.length);
          if (modeRef.current === "Study") {
            announce(`Step ${steps.length} ready: ${parsed.step.title}.`);
          }
        }
      }
    };

    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep the unfinished last line for later
        lines.forEach(handleLine);
      }
      if (buffer.trim()) handleLine(buffer);

      // If Gemini ignored the format, show everything as one step
      if (stepsRef.current.length === 0 && rawText.trim()) {
        handleLine(`STEP: Answer | ${rawText.trim().replace(/\s+/g, " ")}`);
      }
      if (abortRef.current !== controller) return; // a newer question took over

      if (pausedRef.current) {
        finishWaitingRef.current = true; // finish when the user resumes
      } else {
        finishAnswer();
      }
    } catch (error) {
      if (controller.signal.aborted) return; // the user pressed Stop
      console.error(error);
      setStatus("error");
      setWritten(stepsRef.current.length);
      setQuestion(q); // put the question back so Enter tries again
      announce("Something went wrong and the answer didn't finish. Press Enter to try again.");
    }
  }

  function finishAnswer() {
    const count = stepsRef.current.length;
    setWritten(count);
    setStatus("done");
    setActiveStep(0);
    setShowDetails(false);
    if (modeRef.current === "Study") {
      focusStep(0, true);
    } else if (modeRef.current === "Quiet") {
      setTimeout(() => titleRef.current?.focus(), 50);
      announce(`Answer complete. ${count} steps.`);
    } else {
      setTimeout(() => titleRef.current?.focus(), 50);
      const summary = summaryRef.current ? ` Summary: ${summaryRef.current}` : "";
      announce(
        `Answer ready. ${count} steps.${summary} Press Option D to hear step 1, or Option N for the next step.`
      );
    }
  }

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
      pausedRef.current = true;
      setStatus("paused");
      announce(`Paused. ${written} steps shown. New steps will wait. Press Option P to resume.`);
    } else if (status === "paused") {
      pausedRef.current = false;
      const waiting = stepsRef.current.length - written;
      if (finishWaitingRef.current) {
        finishAnswer();
        return;
      }
      setStatus("writing");
      setWritten(stepsRef.current.length);
      announce(
        waiting > 0
          ? `Resumed. ${waiting} new ${waiting === 1 ? "step" : "steps"} ready.`
          : "Resumed."
      );
    }
  }

  function stopGenerating() {
    if (!isGenerating) return;
    abortRef.current?.abort();
    abortRef.current = null;
    pausedRef.current = false;
    setStatus("stopped");
    setActiveStep(0);
    setShowDetails(false);
    setTimeout(() => titleRef.current?.focus(), 0);
    const tip = mode === "Quiet" ? "" : " Press Option D to hear step 1.";
    announce(
      written > 0
        ? `Stopped. ${written} steps were written.${tip}`
        : "Stopped before any steps were written."
    );
  }

  // ---------- Moving through steps ----------
  // Move VoiceOver to a step: its title only, or (full) title plus explanation
  function focusStep(index: number, full: boolean) {
    setTimeout(() => {
      const target = full
        ? bodyRefs.current[index] ?? headingRefs.current[index]
        : headingRefs.current[index];
      target?.focus();
    }, 30);
  }

  function goToStep(index: number, withDetails = false) {
    setActiveStep(index);
    setShowDetails(withDetails);
    focusStep(index, withDetails || modeRef.current === "Study");
  }

  // ---------- Welcome and setup ----------
  function finishSetup(chosen: Mode) {
    setMode(chosen);
    modeRef.current = chosen;
    saveSetup(chosen);
    setOnboarded(true);
    setTimeout(() => inputRef.current?.focus(), 30);
    announce(
      `You're all set. Mode: ${chosen}. Ask a question whenever you're ready. Press question mark anytime to hear the shortcuts.`
    );
  }

  function reopenSetup() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPanelOpen(false);
    setOnboarded(false);
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
      if (!onboarded) return; // the welcome screen has its own keys
      const typing = document.activeElement === inputRef.current;

      // Option + / opens the shortcuts panel from anywhere, even while typing
      if (e.altKey && e.code === "Slash") {
        e.preventDefault();
        togglePanel();
        return;
      }

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
    status === "writing" ? `Writing step ${written + 1}…`
    : status === "paused" ? `Paused · ${written} steps shown`
    : status === "stopped" ? `Stopped · ${written} steps`
    : status === "error" ? `Something went wrong · ${written} steps`
    : `Answer ready · ${written} steps`;

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
        { keys: "?", spoken: "Question mark, or Option slash", label: "Show or hide this panel" },
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
        {onboarded && (
          <button type="button" className="link-button" onClick={reopenSetup}>
            Setup and help
          </button>
        )}
      </header>

      <div className="layout">
        <main className="conversation">
          {!onboarded ? (
            <Onboarding
              initialMode={mode}
              announce={announce}
              onDone={finishSetup}
            />
          ) : (
          <>
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
                {answer.title || (status === "error" ? "Something went wrong" : "Writing your answer…")}
              </h1>

              {status === "done" && answer.summary && (
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
                    <li key={i} className={isActive ? "step active" : "step"}>
                      <div className="step-header">
                        <span className="step-number" aria-hidden="true">
                          {i + 1}
                        </span>
                        <h2
                          className="step-title"
                          ref={(el) => { headingRefs.current[i] = el; }}
                          tabIndex={-1}
                        >
                          <span className="visually-hidden">
                            {isGenerating ? `Step ${i + 1}:` : `Step ${i + 1} of ${written}:`}{" "}
                          </span>
                          {step.title}
                        </h2>
                        {isActive && (
                          <span className="now-tag" aria-hidden="true">Now reading</span>
                        )}
                      </div>
                      {showBody && (
                        <p
                          className="step-body"
                          ref={(el) => { bodyRefs.current[i] = el; }}
                          tabIndex={-1}
                        >
                          <span className="visually-hidden">
                            {isGenerating
                              ? `Step ${i + 1}, ${step.title}. `
                              : `Step ${i + 1} of ${written}, ${step.title}. `}
                          </span>
                          {step.body}
                        </p>
                      )}
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
                  aria-keyshortcuts="Shift+/ Alt+/"
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
              placeholder="For example: How do I cook a steak?"
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
          </>
          )}
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
                aria-keyshortcuts="Shift+/ Alt+/"
              >
                Close <kbd aria-hidden="true">?</kbd>
              </button>
            </div>
            <p className="panel-intro">
              Stays open while you listen. Press ? or Option / to close.
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

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export type Mode = "Skim" | "Study" | "Quiet";

const OPTIONS: { mode: Mode; description: string; sample: string }[] = [
  {
    mode: "Skim",
    description:
      "A short summary and the main headings, so you get the big picture fast and choose what to hear in full.",
    sample:
      "Sample of Skim. Answer ready. 5 steps. Summary: Prep, season, sear, and rest the steak. Press Option D for details, or Option N for the next step.",
  },
  {
    mode: "Study",
    description:
      "The full answer, one section at a time, so you can follow long or detailed material closely.",
    sample:
      "Sample of Study. Step 1 of 5: Prep the steak. Take it out of the fridge 30 minutes before cooking so it cooks evenly.",
  },
  {
    mode: "Quiet",
    description:
      "Only tells you when an answer starts and finishes. You move through it yourself.",
    sample: "Sample of Quiet. Answer complete. 5 steps.",
  },
];

type Props = {
  initialMode: Mode;
  announce: (message: string) => void;
  onDone: (mode: Mode) => void;
};

// The welcome screen: explains what Clearly is, then asks how to listen.
export default function Onboarding({ initialMode, announce, onDone }: Props) {
  const [choice, setChoice] = useState<Mode>(initialMode);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Start screen reader users at the welcome heading
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Number keys 1, 2, 3 pick a mode
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const index = ["1", "2", "3"].indexOf(e.key);
      if (index === -1 || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const picked = OPTIONS[index].mode;
      setChoice(picked);
      announce(`${picked} selected.`);
      document.getElementById(`mode-${picked}`)?.focus();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [announce]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onDone(choice);
  }

  return (
    <section className="onboarding" aria-labelledby="welcome-title">
      <h1 id="welcome-title" ref={headingRef} tabIndex={-1}>
        Welcome to Clearly
      </h1>
      <p className="lead">
        Clearly reads AI answers to you in a way you can follow by ear. It
        tells you when an answer starts and finishes, how many steps it has,
        and lets you move through it one step at a time.
      </p>

      <ul className="how-it-works">
        <li>
          <strong>Ask anything</strong> in the message box, the same way you
          would in any AI chat.
        </li>
        <li>
          <strong>Hear the shape first:</strong> "Answer ready, 5 steps," plus a
          one sentence summary.
        </li>
        <li>
          <strong>Move at your own pace</strong> with Option N for the next
          step and Option D for details. Press ? anytime for every shortcut.
        </li>
      </ul>

      <form onSubmit={handleSubmit}>
        <fieldset className="mode-choice">
          <legend>
            <span className="step-count">Setup</span>
            How would you like to listen?
          </legend>
          <p className="muted small">
            Press 1, 2, or 3, or use the arrow keys. You can switch anytime
            with Option M.
          </p>

          {OPTIONS.map((option, i) => (
            <div
              key={option.mode}
              className={choice === option.mode ? "choice selected" : "choice"}
            >
              <input
                type="radio"
                id={`mode-${option.mode}`}
                name="mode"
                value={option.mode}
                checked={choice === option.mode}
                onChange={() => setChoice(option.mode)}
              />
              <span className="choice-key" aria-hidden="true">
                {i + 1}
              </span>
              <label htmlFor={`mode-${option.mode}`} className="choice-text">
                <span className="choice-title">{option.mode}</span>
                <span className="choice-desc">
                  {option.description}
                </span>
              </label>
              <button
                type="button"
                className="sample-button"
                onClick={() => announce(option.sample)}
              >
                <span aria-hidden="true">▶</span> Hear a sample
                <span className="visually-hidden"> of {option.mode}</span>
              </button>
            </div>
          ))}
        </fieldset>

        <div className="onboarding-footer">
          <button
            type="button"
            className="link-button"
            onClick={() => onDone("Skim")}
          >
            Skip setup (use Skim)
          </button>
          <button type="submit" className="send">
            Start with {choice}
          </button>
        </div>
      </form>
    </section>
  );
}

// Back and forward (#301): what was on screen, step by step, as a browser keeps it. A step is
// a plain object; its key says which view it is. A new key adds a step, the same key only
// brings the current step up to date (scroll, filters). For this run only, 50 steps at most.
export const MAX_STEPS = 50;

export function navHistory(keyOf, max = MAX_STEPS) {
  let steps = [], at = -1;
  return {
    // The view now: a new step when its key changed, else the current one updated.
    note(step) {
      if (at >= 0 && keyOf(steps[at]) === keyOf(step)) { steps[at] = step; return false; }
      steps = steps.slice(0, at + 1).concat([step]);
      if (steps.length > max) steps = steps.slice(steps.length - max);
      at = steps.length - 1;
      return true;
    },
    // The step to show going back or forward, skipping any `ok` turns down; null at the end.
    back(ok = () => true) { return move(-1, ok); },
    forward(ok = () => true) { return move(1, ok); },
    get current() { return at >= 0 ? steps[at] : null; },
    get size() { return steps.length; },
    get index() { return at; },
  };
  function move(dir, ok) {
    for (let i = at + dir; i >= 0 && i < steps.length; i += dir) {
      if (ok(steps[i])) { at = i; return steps[i]; }
    }
    return null;
  }
}

# model-fit

A mod that checks whether the main chat's model and effort fit the task in front of it, and offers to change them when they do not.

## Language

**Setting**:
The model and effort level the main chat is using now, as `/model` and `/effort` show them.
_Avoid_: Config, current model

**Recommendation**:
The model and effort level the mod judges to fit the task in front of the main chat.
_Avoid_: Suggestion, advice

**Mismatch**:
The state in which the Recommendation differs from the Setting in model, effort or both.
_Avoid_: Drift, misfit

**Switch**:
Changing the Setting to the Recommendation, by the person pressing the button or by Auto.
_Avoid_: Apply, upgrade, downgrade (use these only for the direction of a Switch)

**Trigger**:
What makes the mod look for a Mismatch: Off (never), On skill (each time a skill starts, typed by the person or called by the model), or Each prompt (every prompt the person sends, and every skill start as well).
_Avoid_: Cadence, frequency, mode

**Auto**:
The mode in which the mod performs a Switch itself whenever a Mismatch is found.
_Avoid_: Autopilot, auto-switch

**Pause**:
The state in which Auto is suspended for the rest of the session because the person changed the Setting themself.
_Avoid_: Override, pin

**Judge**:
The cheap model call that reads a short digest of the session and the new prompt and returns a Recommendation with its reason.
_Avoid_: Classifier, analyzer

**Rubric**:
The rules the Judge follows to map a task to a Recommendation; by default the person's own model-selection policy.
_Avoid_: Policy, criteria

**Fixed skill**:
A skill the Rubric maps straight to a model, so starting it yields a Recommendation without asking the Judge.
_Avoid_: Mapped skill, known skill

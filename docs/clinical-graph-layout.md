# Clinical graph coordinate audit and model

## Pre-edit audit (2026-11-23; source only)

Pipeline: app targetEntries reads structured session programs (or legacy SOAP
recovery), filters actual target IDs and attaches session date/provider metadata.
buildProgramSkillChart delegates measurement selection to skill-graph-measurements;
zeros remain numeric and missing values null. Behavior builders deduplicate entries
and gate incomparable units through behavior-graph-measurements. Caregiver builders
use fidelity values and goal/target names. None of these builders computes pixels.

Program phases originate in program-phase-workflow and graph phase management;
classification uses programPhaseAt/deriveProgramPhases, independently of rendering.
Historical decisions retain program scope and explicit baselineBefore semantics.
Mastery comes from target status history with target IDs/name/date/timestamp.
Report snapshots supply captured configuration; report-utils normalizes phase
metadata and formats analysis. Snapshot observations remain live input, not copied
or rewritten by graph layout.

Old x-coordinate paths:
- buildChartLayout: date sequence or elapsed-calendar scale, 28px maximum padding,
  centered one-date fallback; a second markerXByDate map used 6/16px offsets,
  next-point minus 4px, and final-point 4/10px offsets.
- buildObservationEventPositions: shared date slots and metadata-only intraday
  offsets; buildPhaseTransitionLayout scaled these to at most +/-12px.
- buildPhaseTransitionLayout: target-specific mastery clamp, separate +/-16px
  edge fallbacks and midpoint positioning. It considered only associated target
  anchors, so a midpoint could coincide with another target's observation.
- phaseLinePosition: resolved renderX or independent date-index midpoint.
- xPositionForMarkerDateWithMode: renderX, marker map, exact date anchor,
  neighboring date midpoint, or endpoint fallback. Exact/endpoint fallbacks could
  overlap data. A redundant xPositionForMarkerDate wrapper also remained.
- vertical lines, phase labels, markerPositions/breaks, and inspection each called
  these resolution helpers separately. Raw and moving-average data used pointX,
  with independent fallback to dateXPositions. Mastery broke both lines.
- responsive label layout shifts text boxes, not anchors. Inspection scales stored
  canvas coordinates to CSS pixels and groups by unchanged clinical dates.
- main graphs use responsive canvas dimensions; modal/report use desktop sizing.
  Skill/caregiver use sequence spacing; behavior uses calendar spacing. All reach
  drawLineChart, but differing width caps could change geometry at equal widths.

Analysis sorts observations by date/time, calculates explicit phase means, latest
valid current level, last-five treatment performance and regression. Moving
averages retain source-observation alignment. These numerical paths are separate
from marker placement and are preserved.

## Unified model

buildClinicalGraphLayout is the sole rendering coordinate authority. Date anchors
are computed first; observation metadata alone refines intraday anchors. Events
cannot affect that stage. Open intervals are formed between all valid observation
anchors and plot-edge annotation regions. Semantic event bounds select an interval:
phase events use time/reference ordering; mastery uses associated target dates and
legacy display clamps; environmental annotations retain configured ordering.
Global intervals prevent events from landing on unrelated target dots as well.
Events sharing an interval sort deterministically and divide its interior evenly.
The layout exposes date/observation anchors, intervals, resolved events, phase
boundary, label anchors, and break coordinates. Each event has one renderX used by
lines, labels, inspection and segmentation. Mastery is non-breaking. Moving
averages use their original observation anchors. Equal inputs and plot dimensions
produce equal geometry across surfaces; different container sizes scale naturally.

Compatibility exports buildChartLayout (date anchors only) and
buildPhaseTransitionLayout (alias to the unified layout) remain for existing callers.
Ambiguous mastery associations are omitted; no persisted data is modified.

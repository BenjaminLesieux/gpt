import { model } from "@coderline/alphatab";
import type { Score, MasterBar } from "./types/score.js";
import type {
  MergeResult,
  ScoreMetaMerge,
  MasterBarMerge,
  TrackMerge,
} from "./types/merge.js";

/**
 * Applies a `MergeResult` to the `ours` Score in-place, producing the merged output.
 *
 * Strategy per granularity:
 *   - Auto-resolved fields → value is written to ours immediately.
 *   - Auto-resolved bars (one side changed, or both-same) → ours' bar ref is replaced with
 *     theirs' bar when resolvedFrom is "theirs"; kept as-is for "ours" / "both-same".
 *   - Conflict bars → left as ours' version. User must resolve via the desktop UI
 *     before committing. The sidecar records exactly which paths need resolution.
 *   - theirs-only bars → theirs' bar (and masterBar) is copied into ours.
 *
 * After this call, `ours` is ready to be exported to bytes via `Gp7Exporter.export()`.
 */
export function applyMerge(ours: Score, theirs: Score, result: MergeResult): void {
  applyMeta(ours, result.meta);
  applyMasterBars(ours, theirs, result.masterBars);
  applyTracks(ours, theirs, result.tracks);
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function applyMeta(ours: Score, meta: ScoreMetaMerge): void {
  if (meta.title.status  === "resolved") ours.title  = meta.title.value;
  if (meta.artist.status === "resolved") ours.artist = meta.artist.value;
  if (meta.album.status  === "resolved") ours.album  = meta.album.value;
  if (meta.tempo.status  === "resolved") applyTempo(ours, meta.tempo.value);
}

// Score.tempo is a getter derived from masterBars[0].tempoAutomations[0].value — no setter exists.
function applyTempo(score: Score, bpm: number): void {
  const mb0 = score.masterBars[0];
  if (!mb0) return;
  const existing = mb0.tempoAutomations.find(
    (a) => a.type === model.AutomationType.Tempo && a.ratioPosition === 0,
  );
  if (existing) {
    existing.value = bpm;
  } else {
    const a = new model.Automation();
    a.type = model.AutomationType.Tempo;
    a.isLinear = false;
    a.ratioPosition = 0;
    a.value = bpm;
    a.isVisible = false;
    mb0.tempoAutomations.unshift(a);
  }
}

// ─── MasterBars ───────────────────────────────────────────────────────────────

function applyMasterBars(ours: Score, theirs: Score, masterBars: MasterBarMerge[]): void {
  for (const mbMerge of masterBars) {
    const i = mbMerge.index;
    const oursMb  = ours.masterBars[i];
    const theirsMb = theirs.masterBars[i];

    if (!oursMb && theirsMb) {
      // theirs-only: adopt theirs' whole masterBar object
      ours.masterBars[i] = theirsMb;
      continue;
    }
    if (!oursMb) continue;

    applyMasterBarFields(oursMb, mbMerge);
  }
}

function applyMasterBarFields(mb: MasterBar, merge: MasterBarMerge): void {
  const f = merge.fields;
  if (f.timeSignatureNumerator.status   === "resolved") mb.timeSignatureNumerator   = f.timeSignatureNumerator.value;
  if (f.timeSignatureDenominator.status === "resolved") mb.timeSignatureDenominator = f.timeSignatureDenominator.value;
  if (f.timeSignatureCommon.status      === "resolved") mb.timeSignatureCommon      = f.timeSignatureCommon.value;
  if (f.isFreeTime.status               === "resolved") mb.isFreeTime               = f.isFreeTime.value;
  if (f.tripletFeel.status              === "resolved") mb.tripletFeel              = f.tripletFeel.value;
  if (f.isAnacrusis.status              === "resolved") mb.isAnacrusis              = f.isAnacrusis.value;
  if (f.isDoubleBar.status              === "resolved") mb.isDoubleBar              = f.isDoubleBar.value;
  if (f.isRepeatStart.status            === "resolved") mb.isRepeatStart            = f.isRepeatStart.value;
  if (f.repeatCount.status              === "resolved") mb.repeatCount              = f.repeatCount.value;
  if (f.alternateEndings.status         === "resolved") mb.alternateEndings         = f.alternateEndings.value;
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

function applyTracks(ours: Score, theirs: Score, tracks: TrackMerge[]): void {
  for (const trackMerge of tracks) {
    const oursTrack   = ours.tracks[trackMerge.trackIndex];
    const theirsTrack = theirs.tracks[trackMerge.trackIndex];
    if (!oursTrack || !theirsTrack) continue;

    const oursStave   = oursTrack.staves[0];
    const theirsStave = theirsTrack.staves[0];
    if (!oursStave || !theirsStave) continue;

    for (const barMerge of trackMerge.bars) {
      const idx = barMerge.masterBarIndex;

      switch (barMerge.status) {
        case "equal":
        case "ours-only":
          // Nothing to change — ours is already correct.
          break;

        case "auto-resolved":
          if (barMerge.resolvedFrom === "theirs") {
            // Theirs changed it, ours didn't — copy theirs' bar reference.
            const theirsBar = theirsStave.bars[idx];
            if (theirsBar) oursStave.bars[idx] = theirsBar;
          }
          // "ours" → keep as-is; "both-same" → ours already has the right content.
          break;

        case "theirs-only": {
          // Bar exists in theirs but not in ours — add it.
          const theirsBar = theirsStave.bars[idx];
          if (theirsBar) oursStave.bars[idx] = theirsBar;
          break;
        }

        case "conflict":
          // Keep ours' bar as-is. The conflict sidecar records what needs resolving.
          // Fine-grained field-level resolution (choosing ours vs theirs per field)
          // is applied by `applyResolution()` in the desktop after the user decides.
          break;
      }
    }
  }
}

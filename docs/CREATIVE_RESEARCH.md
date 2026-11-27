# Creative research: from clips to direction

Agent Village already coordinates research, planning, tools, and review. This
document surveys the open-source creative ecosystem around short-form video and
records the patterns worth borrowing, the licenses to respect, and the capability
slices we can ship without compromising the project's constraints:

- zero npm dependencies,
- Node 20+,
- deterministic and offline by default,
- no hidden uploads, rendering farms, or credential collection.

The first shipped slice is **Director**, a deterministic pre-production workbench
(`/director.html`, `lib/director.mjs`). It is deliberately not a CapCut clone. It
turns a brief into a storyboard, multi-track timeline, caption cues, look and sound
direction, publish kit, production checklist, and NLE-ready interchange files. A
separate Shorts Studio track (PR #1) owns media sourcing and compositing.

## Method

Research was done through the GitHub API and repository pages in November 2026,
querying CapCut alternatives, browser NLEs, agentic video systems, programmatic
video, motion graphics, captioning, audio, design tooling, and generative art.
Star counts below are approximate snapshots from that pass and are included only
to indicate ecosystem gravity, not quality.

## Landscape

### CapCut-like browser editors

| Repository | License | What it demonstrates |
|---|---|---|
| [`OpenCut-app/OpenCut`](https://github.com/OpenCut-app/OpenCut) | MIT | A browser-first timeline, media bin, preview canvas, and project state. The most direct "CapCut alternative" reference. |
| [`jub0t/Concat`](https://github.com/jub0t/Concat) | AGPL-3.0 | Desktop editing workflow and clip interaction patterns. |
| [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes) | Apache-2.0 | Generated-video pipeline with composable scenes. |
| [`nexu-io/openmotion`](https://github.com/nexu-io/openmotion) | Apache-2.0 | Programmatic motion and template-driven scenes. |
| [`storytold/filmcraft`](https://github.com/storytold/filmcraft) | Apache-2.0 | Story-first editing and assembly. |
| [`0xsline/OpenChatCut`](https://github.com/0xsline/OpenChatCut) | AGPL-3.0 | Conversational editing surface. |
| [`Augani/openreel-video`](https://github.com/Augani/openreel-video) | MIT | Lightweight reel assembly. |
| [`pireel/pireel`](https://github.com/pireel/pireel) | AGPL-3.0 | Short-form reel workflow. |

### Programmatic and agentic video

| Repository | License | What it demonstrates |
|---|---|---|
| [`remotion-dev/remotion`](https://github.com/remotion-dev/remotion) | Custom (not OSI) | React-driven video as code. Study the composition model; do not copy code or assume the license permits our use. |
| [`Zulko/moviepy`](https://github.com/Zulko/moviepy) | MIT | Python clip algebra and compositing primitives. |
| [`mifi/editly`](https://github.com/mifi/editly) | MIT | JSON-to-video editing with a declarative timeline. |
| [`dmtrKovalenko/fframes`](https://github.com/dmtrKovalenko/fframes) | MIT | Typed, declarative video scenes. |
| [`OpenMontageInc/OpenMontage`](https://github.com/OpenMontageInc/OpenMontage) | AGPL-3.0 | End-to-end automated montage. |
| [`Vincentwei1021/video-shotcraft`](https://github.com/Vincentwei1021/video-shotcraft) | Apache-2.0 | Shot-level planning and generation prompts. |
| [`kajisho5/ffmpeg-skill`](https://github.com/kajisho5/ffmpeg-skill) | MIT | Encapsulating FFmpeg operations behind a safe skill interface. |
| [`JuneYaooo/rea-video`](https://github.com/JuneYaooo/rea-video) | Apache-2.0 | Agent-style video workflow. |
| [`openfilm/openfilm`](https://github.com/openfilm/openfilm) | MIT | Open film production pipeline. |

### Captions, audio, design, and generative art

| Repository | License | What it demonstrates |
|---|---|---|
| [`GraphiteEditor/Graphite`](https://github.com/GraphiteEditor/Graphite) | Apache-2.0 | Node-graph creative tooling and a serious editor UX. |
| [`mojs/mojs`](https://github.com/mojs/mojs) | MIT | Motion-graphics primitives for the web. |
| [`processing/p5.js`](https://github.com/processing/p5.js) | LGPL-2.1 | Creative coding and generative sketching. |
| [`mrdoob/three.js`](https://github.com/mrdoob/three.js) | MIT | WebGL previews and 3D motion. |
| [`theatre-js/theatre`](https://github.com/theatre-js/theatre) | Apache-2.0 | Keyframe sequencing and an editor-style animation state. |
| [`invoke-ai/InvokeAI`](https://github.com/invoke-ai/InvokeAI) | Apache-2.0 | Generative image workflows and asset management. |
| [`multimodal-art-projection/YuE`](https://github.com/multimodal-art-projection/YuE) | Apache-2.0 | Music generation direction. |
| [`WEIFENG2333/VideoCaptioner`](https://github.com/WEIFENG2333/VideoCaptioner) | GPL-3.0 | Caption-first editing, segmentation, and review. |

## License gate

- **MIT / Apache-2.0** can inform implementation, but we still write clean-room
  code in this repository's own style and keep attribution where required.
- **AGPL-3.0 / GPL-3.0** projects are studied for behavior and interaction only.
  No code, assets, or templates are copied into Agent Village.
- **Remotion's custom license** is not an OSI license. We do not copy it, bundle
  it, or build a dependency on it. The composition *idea* is not copyrightable;
  the implementation is.
- Generated exports contain only the user's brief and our deterministic text.
  Fonts referenced in plans are system stacks, not redistributed font files.
- Audio guidance points users to licensed or original music; the product does
  not download tracks.

## Patterns worth borrowing

1. **A project is data, not pixels.** OpenCut, editly, fframes, and OTIO all
   separate the edit decision list from rendering. Director follows this: the
   plan is a portable JSON object and every export is a projection of it.
2. **Interchange beats lock-in.** SRT/VTT cover captions, CSV covers production,
   EDL covers cut-only handoff, FCPXML covers Final Cut and DaVinci imports, and
   OTIO is the neutral timeline format. A tool that cannot render can still be
   useful if it hands off cleanly.
3. **Caption-first, sound-off-first.** Short-form video is watched muted. Director
   generates bounded caption cues from the voiceover, keeps them inside scene
   boundaries, and treats on-screen text as a first-class field.
4. **Safe areas are part of the plan.** Platform UI changes, but the practice of
   reserving top/bottom zones does not. Every aspect preset carries a safe-area
   note, and platform notes call out native vs. requested aspect.
5. **Direction is more than a shot list.** A usable plan includes purpose, shot,
   camera, lighting, action, B-roll, transition, sound, generation prompts, and an
   editor note. Those fields make the plan reviewable before anyone shoots.
6. **A publish kit closes the loop.** Titles, description, hashtags, thumbnail
   direction, and chapters turn an edit into something publishable.
7. **Accessible looks are testable.** Palette roles carry measured contrast ratios
   and WCAG labels; "decorative" colors are explicitly not for small text.
8. **Determinism is a feature.** A seed reproduces the same plan, which makes
   reviews, tests, and agent runs debuggable.

## What shipped: Director

- `lib/director.mjs` — seeded planner, narrative roles, timing allocation,
  captions, palette/contrast, typography, audio brief, publish kit, production
  checklist, and exporters.
- `POST /api/director/plan` — brief → full plan plus every export.
- `POST /api/director/export` — reflow an edited plan and return a download
  descriptor (`format`, `filename`, `contentType`, `body`).
- `GET /api/director/formats` — formats, platforms, aspects, tones, paces, FPS.
- `storyboard` — a safe agent tool so the Planner can use the same engine during
  a mission.
- `/director.html` — an editable workbench with timeline, scene cards, palette,
  type, audio, publish kit, production checklist, and downloads.

Exports: `json`, `markdown`, `srt`, `vtt`, `csv`, `edl`, `fcpxml`, `otio`,
`youtube`.

Deliberate limits: no media upload, no network fetch, no FFmpeg, no rendering,
no font binaries, no platform publishing. FCPXML and OTIO reference placeholder
media and must be relinked after import.

## Roadmap

### Wave 2 — media-aware direction

- Optional asset attachments per scene (local paths or uploads handled by the
  existing media boundary, not by Director).
- Duration detection from real clips, with a "fit the plan to the footage" pass.
- Waveform/beat-grid import so cut points snap to measured transients.
- Caption styling presets rendered into the browser preview (still no burn-in
  server-side).
- A shot-list PDF via the browser's print stylesheet, without a PDF dependency.

### Wave 3 — round-trip editing

- Import an edited FCPXML/OTIO timeline back into the plan (subset of features).
- Diff two plans: timing, captions, shot changes, palette changes.
- Plan versioning with named revisions and a review comment per scene.
- A "coverage" checker that flags missing B-roll, unreadable captions, unsafe
  text placement, and claims that need verification.

### Wave 4 — generative and motion

- Use the existing `sd_generate` tool to create scene stills from `stillPrompt`,
  storing only local artifacts and provenance.
- Browser-native motion previews with CSS/Canvas; optional WebGL only if it can
  stay dependency-free.
- Template packs for common formats (product launch, tutorial, before/after,
  talking head) expressed as data, not code.
- Audio direction handoff files for external music tools; no model bundling.

### Wave 5 — collaboration and scale

- Multi-user review with per-scene approvals and deterministic merge rules.
- A render queue adapter interface, with rendering performed by an external,
  explicitly configured worker — never by the API process by default.
- Publishing adapters behind explicit capability grants, with human approval and
  an auditable diff of what will be published.

## Non-goals

- Rebuilding a full NLE in the browser.
- Shipping FFmpeg, codec binaries, or model weights in the repository.
- Scraping platform audio or templates.
- Copying AGPL/GPL code or Remotion's custom-licensed implementation.
- Automatically publishing to a platform without an explicit human approval step.

## References

- OpenTimelineIO: <https://opentimelineio.readthedocs.io/>
- Final Cut Pro FCPXML reference: <https://developer.apple.com/documentation/professional-video-applications/fcpxml-reference>
- CMX 3600 EDL format overview: <https://en.wikipedia.org/wiki/Edit_decision_list>
- WebVTT: <https://www.w3.org/TR/webvtt1/>
- SubRip (SRT): <https://en.wikipedia.org/wiki/SubRip>
- WCAG contrast guidance: <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- GitHub search used for discovery: <https://github.com/search?q=capcut+alternative&type=repositories>

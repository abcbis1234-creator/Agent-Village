# Toon2D Shorts integration

This adapter targets the original `toon2d-shorts` package. It does not replace or rewrite that renderer.

## Expected folder layout

Extract the supplied `toon2d-shorts.zip` so that the repository has:

```text
Agent-Village/
  vendor/
    toon2d-shorts/
      t2d.py
      requirements.txt
      toon2d/
      docs/
      examples/
```

Do not put a Python virtual environment, Whisper model cache, or generated render projects inside the repository.

## Local setup

1. Extract `toon2d-shorts.zip` into `vendor/toon2d-shorts`.
2. Create a virtual environment for the renderer.
3. Install the package requirements from that folder.
4. Set `TOON2D_HOME` to the absolute path of `vendor/toon2d-shorts`.
5. Set `PYTHON_EXECUTABLE` to the Python executable in the virtual environment if it is not available as `python3`.

Example on macOS/Linux:

```bash
python3 -m venv .venv-toon2d
. .venv-toon2d/bin/activate
python -m pip install -r vendor/toon2d-shorts/requirements.txt
export TOON2D_HOME="$PWD/vendor/toon2d-shorts"
export PYTHON_EXECUTABLE="$PWD/.venv-toon2d/bin/python"
npm start
```

The package requirements are substantial (the original README estimates about 400 MB installed). The captions-only `silent` path does not need a Whisper model download, but it still needs the renderer's Python dependencies and bundled FFmpeg package.

## Current adapter behaviour

The Shorts Studio **Prepare Toon2D project** action is available only after a project is approved. It:

1. Writes the narration to `script.txt`.
2. Runs the original `t2d.py silent` command to create a silent audio track and word timings at the target duration.
3. Matches each scene's narration to its exact starting word in the script.
4. Writes a `storyboard.json` using the renderer's actual `start_word`, `set`, `mood`, `cast`, and `keys` fields.
5. Runs `t2d.py plan` and returns the generated plan summary.

Prepared projects are written under `data/toon2d-projects/<project-id>`.

The editor's scene controls map to the renderer's supported sets, moods, character archetypes, poses, and expressions. The free-text visual notes are retained as creative notes; they are not automatically converted into custom props or artwork.

## Not implemented yet

- No MP4 render is started by the preparation action.
- No narration voice is synthesized; the current path is captions-only with a silent track.
- Still-frame review, resumable render chunks, MP4 join, and final QA need a separate background-job workflow.
- Production authentication is required before exposing project APIs on a public deployment.

The adapter deliberately uses the original renderer CLI and its project files rather than copying or reimplementing its drawing engine.

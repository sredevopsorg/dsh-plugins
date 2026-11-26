# Video Explainer checks

Answer each check yes or no before delivering the final video. Fix any no first.

## Script and audience

1. Does the opening 3 seconds pose a concrete question, tension, or number that reads clearly with the sound off?
2. Does the final scene directly answer the question opened by the hook?
3. Are every claim, number, quote, and step verified against the user's files or primary sources?
4. Is the video at or under the `Max duration` cap (`120s` default, aiming for `60 to 75s`)?
5. Do both narration and on-screen labels match the `Audience` level (`general` default: plain English with zero file paths, variable names, error codes, or unexplained acronyms)?
6. Is one concrete example traced end-to-end without AI-slop phrasing?

## Visual craft and audio

7. Does the render match the chosen `Mode` (`motion`, `illustrated`, or `3d`) with full-frame visuals (60 to 85% of viewport) that visibly transform every 2 to 3 seconds?
8. Did a fresh-eyes check of the contact sheet and opening find no slide-like frames, no clip-art look, and a striking first 15 seconds?
9. Are all on-screen labels short (1 to 4 words), high-contrast, camera-facing in `3d`, and positioned above the bottom caption band?
10. Were all downloaded or captured images and clips inspected for sharpness, attribution, and clean framing?

## QA and review

11. Does `qa.py` pass all `10/10` checks (`duration_cap`, `motion_liveliness`, loudness, sync, black frames, and `hyperframes check` with `errors=0`)?
12. Did you inspect `work/qa/contact.jpg` and `work/qa/opening.jpg` to confirm zero whiteouts, clipped text, broken media, or frozen stretches?
13. Were all browser review notes applied and acknowledged before the final render, and did you ask the user to listen for voice pacing and music balance?

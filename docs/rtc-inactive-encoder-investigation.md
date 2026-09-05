# Native inactive encoder investigation — 2026-09-05

## Observed locally

Windows Discord 1.0.9256, RTX 4080, Equicord with GoLiveBypass Enhanced.
The owner initiated a test share and confirmed the viewer had it fully open.
Only selected numeric RTC fields were inspected; source identifiers and account
identifiers are not recorded here.

- Capture remained around 30 FPS. Native `framesEncoded`, encryption success
  count for video, and target video bitrate stayed zero. Encoder queue drops grew.
- The stream's audio packet and byte counters grew with no reported send failures.
  This proves local transmission, not receiver playback.
- Renderer `selfVideo` and stream-parameter `active` were true. Native encoder
  logs nevertheless reported the simulcast stream as inactive.
- Changing the live codec through `setAudioVideoOverridesTransport` to H.265,
  H.264 and VP8 did not restore frames. Restoring AV1 preserved the failure.
- Disabling capture-device sharing, then testing GDI capture, did not restore
  frames. Original capture options were restored.
- A nonzero pixel request supplied to the renderer did not restore encoding.
  The original request was restored.

## Successful controlled intervention

`setTransportOptions({ keyframeInterval: 1000, alwaysSendVideo: true })` on the
already-sharing native connection restored encoding. `alwaysSendVideo` alone
did not. Restoring the original keyframe behavior reproduced the stall.
Reapplying the combined setting restored sustained AV1 NVIDIA Direct3D output:
2,457 encoded frames, 30 FPS, roughly 2.08 Mbps, zero encoder-queue drops in
the sampled encoder generation. The encrypted-video counter continued growing.

This establishes a local workaround for the inactive native encoder condition.
It does not establish why Discord's native activation policy disabled the
encoder, nor receiver-visible video/audio success on the friend's machine.

## Implemented scope

The existing broadcaster stall detector triggers level-one recovery. After
source reapplication, the shim enables the combined transport settings only if
the original keyframe and always-send values were observed. Caller updates are
remembered while repair remains active. Source change or voluntary stop restores
the latest caller values. Viewer connections, codec selection, gateway routing,
encryption and source selection are not changed by this repair.

The selected share may keep encoding with no viewers until its source stops or
changes. Positive `remoteSinkWantsPixelCount` is a computed quality limit and
must not be described as proof that a viewer is receiving video.

## Validation boundary

Executable tests cover repair activation, preserving caller objects, remembering
new original settings, and restoration on source switch/stop in plugin and
standalone shims. GUI payload regeneration and compilation, and Equicord build
passed. After a clean restart the installed controller loaded; an owner-started
fresh share and receiver confirmation are still needed for end-to-end proof.

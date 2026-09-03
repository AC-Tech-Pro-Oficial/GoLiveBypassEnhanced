#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "golive-gui" / "tests" / "gateway-probe.test.ts"
text = TEST.read_text(encoding="utf-8")

old_interface = '''interface VoiceStatsResumo {\n  statsOk: boolean;\n  sampleHa: number;\n  entradaHa: number;\n  saidaHa: number;\n  captureFrames: number | null;\n  inputFrameRate: number | null;\n  framesEncoded: number | null;\n  encodeFrameRate: number | null;\n}\n'''
new_interface = '''interface VoiceStatsResumo {\n  statsOk: boolean;\n  role?: "broadcaster" | "viewer" | "unknown";\n  sampleHa: number;\n  entradaHa: number;\n  saidaHa: number;\n  captureFrames: number | null;\n  inputFrameRate: number | null;\n  framesEncoded: number | null;\n  encodeFrameRate: number | null;\n  videoExpected?: boolean;\n  framesDecoded?: number | null;\n  decodeFrameRate?: number | null;\n  decodeHa?: number;\n}\n'''
if old_interface not in text:
    raise SystemExit("gateway-probe VoiceStatsResumo anchor missing")
text = text.replace(old_interface, new_interface, 1)

old_builder = '''    "const VOICE_STREAM_AQUECIMENTO_MS = (" + extrairConst("VOICE_STREAM_AQUECIMENTO_MS") + ");\\n" +\n    "const VOICE_DEMANDA_GRACA_MS = (" + extrairConst("VOICE_DEMANDA_GRACA_MS") + ");\\n" +'''
new_builder = '''    "const VOICE_STREAM_AQUECIMENTO_MS = (" + extrairConst("VOICE_STREAM_AQUECIMENTO_MS") + ");\\n" +\n    "const VOICE_VIEWER_AQUECIMENTO_MS = (" + extrairConst("VOICE_VIEWER_AQUECIMENTO_MS") + ");\\n" +\n    "const VOICE_VIEWER_PARADO_MS = (" + extrairConst("VOICE_VIEWER_PARADO_MS") + ");\\n" +\n    "const VOICE_DEMANDA_GRACA_MS = (" + extrairConst("VOICE_DEMANDA_GRACA_MS") + ");\\n" +'''
if old_builder not in text:
    raise SystemExit("gateway-probe native detector builder anchor missing")
text = text.replace(old_builder, new_builder, 1)

if 'expect(g(base)).toBe("video-nativo-travado");' not in text:
    raise SystemExit("legacy broadcaster signal expectation missing")
text = text.replace(
    'expect(g(base)).toBe("video-nativo-travado");',
    'expect(g(base)).toBe("transmissor-video-parado");',
    1,
)

old_media_close_expectation = 'expect(src).toContain("window.__goliveMidiaFechar ? window.__goliveMidiaFechar() : 0");'
if old_media_close_expectation not in text:
    raise SystemExit("legacy automatic media-close expectation missing")
text = text.replace(
    old_media_close_expectation,
    'expect(src).not.toContain("window.__goliveMidiaFechar ? window.__goliveMidiaFechar() : 0");',
    1,
)

viewer_test_anchor = '''  it("oscilacao curta de 3s nao dispara", () => {\n'''
viewer_test = '''  it("viewer reentrando com decoder em zero confirma o zumbi do receptor", () => {\n    const viewer: VoiceContexto = {\n      ...base,\n      voice: {\n        ...base.voice,\n        connections: [{\n          id: 8, kind: "stream", destroyed: false, createdHa: 30_000,\n          stats: {\n            statsOk: true, role: "viewer", sampleHa: 0, entradaHa: -1, saidaHa: -1,\n            captureFrames: null, inputFrameRate: null, framesEncoded: null, encodeFrameRate: null,\n            videoExpected: true, framesDecoded: 0, decodeFrameRate: 0, decodeHa: 15_000,\n          },\n        }],\n      },\n    };\n    expect(g(viewer)).toBe("viewer-video-parado");\n    const stream = viewer.voice.connections[0];\n    expect(g({ ...viewer, voice: { ...viewer.voice, connections: [{\n      ...stream, stats: { ...stream.stats, framesDecoded: 8215, decodeFrameRate: 30, decodeHa: 0 },\n    }] } })).toBeNull();\n  });\n\n'''
if viewer_test_anchor not in text:
    raise SystemExit("gateway-probe insertion anchor missing")
text = text.replace(viewer_test_anchor, viewer_test + viewer_test_anchor, 1)

TEST.write_text(text, encoding="utf-8")
print("Enhanced RTC GUI integration expectations applied successfully")

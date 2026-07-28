# Clone parity receipt (META-241 Phase 1)

- Verdict: **PARITY** (10/10 passed, 0 failed, 0 unsupported)
- Source SHA: `7e3f0fead990a470abc3f2647e0aeec59aafdcfc`
- Target SHA: `4ea6711684bc6157468d24c7ce8a7b3227014bd6`
- Generated: 2026-07-28T10:26:30.864Z (started 2026-07-28T10:26:03.076Z)
- Toolchain: node v22.19.0, npm 10.9.8, vsce 2.15.0, darwin/arm64

| Check | Status | Evidence |
| --- | --- | --- |
| `git.tree-equality` | PASS | sourceSha=7e3f0fead990a470abc3f2647e0aeec59aafdcfc; targetSha=4ea6711684bc6157468d24c7ce8a7b3227014bd6; differingPaths=0; filesCompared=124 |
| `pkg.pack-inventory` | PASS | sourceFiles=28; targetFiles=28; sourceIntegrity=sha512-lyYVn5uYvGg52RqJCTJXj498p+3mjhL+JUB6jeyyM3r8oYXKzTVloX899OURoyqC7gFLDasY4nxn2324JYbyBA==; targetIntegrity=sha512-em2qS+NYXtW4TT5NQh2PPIPD5zvATRr1fsN/mPBMd2ygW5N/E8979WaIu0NMrkPhxRzwm5XRRi2yZkW9iRZ8jw==; sourceSha256=b170eaf1c3d23d059fd074178128f764f5b180e13db7942e4277cb98af7b917a; targetSha256=a46a2c08265002bbb89431712653419c321eab30680a6c1666455d772ed3d23b |
| `pkg.identity` | PASS | name=@workspacejson/codex-mcp; version=0.1.9 |
| `pkg.bins` | PASS | bins=["codex-mcp","workspacejson-codex-mcp"] |
| `mcp.smoke` | PASS | sourcePass=41; sourceFail=0; targetPass=41; targetFail=0 |
| `hooks.behavior` | PASS | cases=5 |
| `installer.assets` | PASS | sourceRuntimeFiles=20; targetRuntimeFiles=20; installExit={"source":0,"target":0} |
| `plugin.surfaces` | PASS | surfaces=[".mcp.json",".codex-plugin","hooks",".agents"] |
| `extension.vsix` | PASS | sourceVsix=../../../../../var/folders/sy/frt_v9rn73lbqr1l92qfjxhw0000gp/T/clone-parity-cnTKer/source/vsix/workspacejson-codex-decorations-0.1.5.vsix; targetVsix=../../../../../var/folders/sy/frt_v9rn73lbqr1l92qfjxhw0000gp/T/clone-parity-cnTKer/target/vsix/workspacejson-codex-decorations-0.1.5.vsix; sourceVsixSha256=5afc7af0809bf89c0ecec0a887770e83a51dd9dfb295e99cd8c4f4992d4e3f70; targetVsixSha256=6e38484a25f152f595f6aa7363f862fc8f9ec5001e486a4e3c574af6df8174ae; sourceAssets=30; targetAssets=30 |
| `generator.resolution` | PASS | resolution=agents-audit version check passed (6 reference(s), pinned to 0.4.3). |

## Intentional differences

None declared; none found.

## Violations

None.

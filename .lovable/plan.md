# Fix blank AI output on the Decart engine

## What the latest test shows
- Connection to Decart succeeds (every setup step reports success).
- **Your camera video never actually leaves the browser.** Decart's own stats report 0 bytes and 0 packets sent for the camera the whole session, even though frames were being encoded (about 20 per second at 1472x832).
- Because Decart receives no frames, it generates nothing: it only sends back an empty audio channel, and no video ever arrives.
- After about 8 seconds Decart closes the session. You were still charged 12 credits for those 6 seconds of blank output.

## Likely causes, most likely first
1. **The upload path never opens.** No network route was ever chosen for sending video. On strict networks this usually means a relay server is needed. The relay (TURN) values were never saved, so there's no relay fallback.
2. **Unusual camera size.** 1472x832 is not a standard size. Decart's library splits it into three quality levels, and it may refuse to send them.
3. **Reference image plus prompt.** The start included a 254 KB reference photo. That's less likely to be the cause, but it's worth checking in isolation.

## Changes (Decart path only, Xmax untouched)
1. **Standard camera size for Decart:** ask the camera for 1280x720 when Decart is the engine. The camera picker stays as it is.
2. **Send one quality level only:** turn off the three-level split in Decart's options, if its library allows that.
3. **Diagnostics:** every 2 seconds for the first 15 seconds, log camera upload bytes and packets, the chosen network route, and the connection state. The next test will then show whether frames are leaving the browser.
4. **No charge until picture appears:** on Decart, start the credit meter only when the first real AI video frame arrives. If no frame arrives within 15 seconds, end the stream with a clear message and charge nothing.
5. **Update Decart's library to 0.2.1** if the registry now allows it (yesterday's install was on hold).

## What I need from you afterwards
Start one Decart stream (try once without a reference image) and send the console output. If uploads still show 0 bytes, the fix is adding the relay server values (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL).

## Technical details
- File: src/routes/_app.stream.tsx (Decart arm only), package.json.
- Stats come from the SDK telemetry fields `outboundVideo.bytesSent/packetsSent` and `connection.selectedCandidatePairs`, or from `getStats()` on the publisher peer connection.
- The billing gate uses the existing `outputVideoTrackRef` unmute / first-frame event. `deduct_and_mark_session` and `log_usage_transaction` are unchanged.

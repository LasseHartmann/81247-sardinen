# CONTEXT.md — 81247 Sardinen (Architektur- & Domänen-Referenz)

## 1. Projektziel & Einsatzgebiet
**81247 Sardinen** ist eine mobile-first Multiplayer-Web-App (100 % Deutsch, „Outdoor Tactical Dark"-Design) für ein reales Outdoor-Versteckspiel einer geschlossenen Freundesgruppe im Münchner Postleitzahlengebiet **81247** (Obermenzing / Schloss Blutenburg / Pipping / Würm-Grünzug).
Laufzeitkosten-Ziel: **0 EUR** (Firebase Realtime Database & Auth auf dem Spark-Plan, OpenStreetMap + Overpass API mit lokalem 81247-Fallback, statisches Hosting auf Vercel Hobby).

## 2. Rollenmodell
- **Spielleiter (`isHost: true`)**: Bestätigt oder bearbeitet das 81247-Spielpolygon, schaltet Freunde per 1-Klick aus `/joinRequests` frei, weist Teams (`SEEKER` / `HIDER`) und GPS-Beacons zu, steuert Start, Pause, Notfall-Abbruch und Runden-Reset.
- **Verstecker (`side: "HIDER"` / „Die Sardinen")**: Genau ein Team. Sucht in `00:00–10:00` (`HIDING`) ein Versteck im bestätigten Polygon, fixiert den geheimen `anchorPoint` und bleibt ab `10:00` innerhalb der **20-Meter-Leash** (3-Punkte-Anti-Jitter bei `accuracy <= 25 m`, 60 s Rückkehrfrist).
- **Sucher-Teams (`side: "SEEKER"`)**: Standardmäßig Team 1–4. Jedes `ACTIVE`-Team sendet über sein `beaconPlayerId`-Gerät gedrosselt Standortdaten (max. alle 6 s und nur bei `> 5 m` Distanzänderung). Nach QR-Scan oder 6-stelligem Ersatzcode wechselt das Team sofort in `JOINED_SARDINES`.

## 3. Phasen, Schrumpf-Radar & Wertung
- `00:00–10:00`: `HIDING` (Versteckphase)
- `10:00–25:00`: `OPEN_SEARCH` (Offene Suche; Speicherung von `searchStartTimestamp` & `pausedBeforeSearchMs`)
- `25:00`: `RADAR_1` ($R_1 = 800\,\text{m}$)
- `30:00`: `RADAR_2` ($R_2 = 400\,\text{m}$)
- `35:00`: `RADAR_3` ($R_3 = 200\,\text{m}$)
- `40:00`: `RADAR_4` ($R_4 = 100\,\text{m}$)
- `45:00+`: `ENDGAME` ($R_5 = 25\,\text{m}$)

**Inside-Out-Radar (`src/geo/radar.ts`)**: Einmalige Berechnung beim Fixieren von $A$ von innen nach außen ($A \to C_5 \to C_4 \to C_3 \to C_2 \to C_1$) mit Flächengleichverteilung ($\sqrt{u}$) und Sicherheitsfaktor $\alpha = 0.85$. Garantiert $\text{dist}(A, C_k) \le R_k$ und $\text{dist}(C_{k-1}, C_k) + R_k \le R_{k-1}$.

**Wertungsformel (`ms`)**:
- `pausedDuringSearchMs = totalPausedMsAtCatch - pausedBeforeSearchMs`
- `searchTimeMs = max(0, (catchTimestampMs - searchStartTimestamp) - pausedDuringSearchMs)`
- `penaltyMs = max(0, sumValidCluePenaltiesMs - sumRefundedPenaltiesMs)`
- `totalTimeMs = searchTimeMs + penaltyMs` (niedrigste Gesamtzeit gewinnt).

## 4. Gehärtete RTDB-Pfad-Isolation & Controller-Engine
Da Cloud Functions bewusst ausgeschlossen sind, erwirbt ein aktives Host- oder Hider-Gerät per atomarer Transaktion den Controller-Lease unter `/games/81247/state/controller` (Heartbeat 5 s, TTL 15 s):
- `/state/hiderPrivate`: Enthält `anchorPoint`, alle zukünftigen `radarStages`, `qrSecret` und `shortCode`. Strikte Lesesperre für aktive Sucher in `database.rules.json`.
- `/teams/{teamId}`: Kein `.read` auf Elternknoten `/teams`; `/public` ist für alle freigeschalteten Spieler lesbar, `/location` ausschließlich für das eigene Team, Hider und Host.
- `/requests/{teamId}/{requestId}` & `/clues/{teamId}/{clueId}`: Idempotente Verarbeitung (`PENDING -> PROCESSING -> ANSWERED / AWAITING_HIDER_MEDIA -> EXPIRED / REJECTED`), Base64-Payload-Limit `<= 95000` Zeichen, 120 s Netto-Spielzeit-Timeout mit einmaliger `-5 Min.` Rückerstattung + Gratis-Donut-Ring.
- Dual-Backend über `src/services/databaseAdapter.ts`: Produktiver Firebase-RTDB-Adapter sowie nahtloser Offline-Demo-Modus (`localStorage` + `BroadcastChannel('sardinen_81247_demo')`).

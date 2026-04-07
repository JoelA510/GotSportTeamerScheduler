[← Back to Documentation Index](docs/README.md)
---

# Phase 4 Governance Framework: Enterprise Overlays & Real-time Sync

**Role**: Lead Enterprise Architect & Governance Supervisor  
**Status**: ACTIVE  
**Scope**: Phase 4 (Observability & Observability Overlays)

---

## 1. Real-time Fidelity & Performance

_Real-time updates must feel instantaneous yet lightweight._

### Pass/Fail Criteria

| Metric                  | Requirement       | Pass Condition                                                                                                                                 |
| :---------------------- | :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **Broadcast Frequency** | Throttled Updates | Progress updates MUST be throttled to **at most** 10 per second (100ms interval) to prevent WebSocket saturation.                              |
| **UI Smoothness**       | 60FPS Transitions | All overlay transitions (mount/unmount/re-render) must maintain 60FPS. Use React `memo` or `requestAnimationFrame` for high-frequency updates. |
| **Animation Quality**   | SquadLogic Pulse  | The "Pulse" animation must be harmonic (non-jarring) and use CSS-accelerated properties (transform/opacity).                                   |

---

## 2. State & Consistency (Cross-User)

_The "Single Source of Truth" must be the database, not the local state._

### Non-Negotiable Guardrails

1. **Re-hydration Integrity**: On page load/refresh, the `ImportContext` MUST query `import_jobs` for any jobs with status `importing` to re-hydrate the overlay.
2. **Tab Synchronization**: Using Supabase Realtime Channels is mandatory. If an import is started in Tab A, the overlay must appear correctly in Tab B within 500ms.
3. **Ghost Job Protection**: Implement a "Stale Job" cleanup. If a job is `importing` but hasn't updated in 5 minutes, it must be marked as `failed` to prevent ghost overlays.

---

## 3. Visual Governance (Enterprise Glass)

_Overlays must provide value without obstructing core workflows._

### UX Requirements

- **Lifecycle Stickiness**: Overlays are **not dismissible** while the engine is in a `critical` state (Writing to DB). They can only be dismissed after a 5-second "Success" grace period.
- **Smart Efficiency Metric**: Every overlay must display the `Smart Match Rate` derived from telemetry (Validations / Total Mapping).
- **Glassmorphism**: Use `backdrop-filter: blur(12px)` and `border-white/10` to match the Enterprise aesthetic.

---

## 4. Operational 'Go/No-Go' Protocol

As the Governance Supervisor, I will evaluate Phase 4 implementation against:

- [ ] **Packet Throttling?** (Is the WebSocket being spammed?)
- [ ] **Refresh Resilience?** (Does the overlay survive a browser crash?)
- [ ] **Feature Isolation?** (Is the overlay correctly guarded by `ENTERPRISE_OVERLAYS`?)

---

> [!IMPORTANT]
> Any Real-time implementation that relies solely on `localStorage` or `BroadcastChannel` without a database fallback will be rejected.

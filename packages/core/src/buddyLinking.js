/**
 * Buddy-field normalization for team generation (project-hardening PR 05).
 *
 * Imported player data carries buddy intent in several shapes — a direct player reference
 * (`buddyId` / `buddy_id`) or a shared code two players both enter (`mutualBuddyCode` /
 * `mutual_buddy_code`). The generator and the conflict hook consume ONE canonical field:
 * `buddyId`. `normalizeBuddyLinks` canonicalizes all variants and emits structured
 * diagnostics for requests it cannot honor. Pure module — no React / Supabase imports.
 *
 * Resolution rules:
 *   - An explicit `buddyId` / `buddy_id` wins over any code.
 *   - A buddy code links players only when EXACTLY two players share the code within the
 *     same division (mirroring the import materialization SQL); bigger groups, singletons,
 *     and cross-division groups are diagnosed instead.
 *   - Direct references are validated (self-reference, missing target, cross-division,
 *     one-sided) — invalid ones are diagnosed here and preserved as-is, so the generator's
 *     own buddy diagnostics still see them (a self-reference falls back to a code link
 *     when one exists).
 *
 * @typedef {Object} BuddyLinkDiagnostic
 * @property {string} code
 * @property {'info' | 'warning'} severity
 * @property {string} message
 * @property {string[]} playerIds
 */

/** Coerce an id-like value to a trimmed non-empty string, or undefined. */
function coerceId(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str === '' ? undefined : str;
}

/**
 * Read a player's canonical buddy reference (`buddyId`, falling back to `buddy_id`),
 * without resolving codes (codes need group context). Safe for frontend reuse
 * (e.g. the conflicts hook).
 * @param {any} player
 * @returns {string | undefined}
 */
export function getCanonicalBuddyId(player) {
  if (!player) return undefined;
  return coerceId(player.buddyId) ?? coerceId(player.buddy_id);
}

/** Read a player's buddy code across naming variants (display form, original case). */
function getBuddyCode(player) {
  if (!player) return undefined;
  const raw = player.mutualBuddyCode ?? player.mutual_buddy_code;
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  return str === '' ? undefined : str;
}

/** Read a player's external buddy request (an EXTERNAL registration key, not a player id). */
function getBuddyRequestKey(player) {
  if (!player) return undefined;
  const raw = player.buddy_request ?? player.buddyRequest;
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  return str === '' ? undefined : str;
}

/** Read a player's external registration key across naming variants. */
function getExternalKey(player) {
  if (!player) return undefined;
  const raw = player.external_registration_id ?? player.externalRegistrationId;
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  return str === '' ? undefined : str;
}

/**
 * Canonicalize buddy fields across a player list. Returns NEW player objects (inputs are
 * not mutated) with canonical `buddyId` set where a valid link exists, plus diagnostics.
 *
 * @param {any[]} players
 * @returns {{ players: any[], diagnostics: BuddyLinkDiagnostic[] }}
 */
export function normalizeBuddyLinks(players) {
  const list = Array.isArray(players) ? players : [];
  /** @type {BuddyLinkDiagnostic[]} */
  const diagnostics = [];
  const byId = new Map();
  for (const player of list) {
    const id = coerceId(player?.id);
    if (id && !byId.has(id)) byId.set(id, player);
  }

  // External-key lookup so a `buddy_request` (an external registration key) can resolve to a
  // player id when the roster carries external_registration_id.
  const playerIdByExternalKey = new Map();
  for (const player of list) {
    const key = getExternalKey(player);
    const id = coerceId(player?.id);
    if (key && id && !playerIdByExternalKey.has(key)) {
      playerIdByExternalKey.set(key, id);
    }
  }

  // Resolve shared buddy codes → reciprocal id links (exactly two players, same division).
  // Codes group case-insensitively, mirroring the import materialization.
  /** @type {Map<string, { code: string, members: any[] }>} */
  const codeGroups = new Map();
  for (const player of list) {
    const code = getBuddyCode(player);
    if (!code) continue;
    const key = code.toLowerCase();
    if (!codeGroups.has(key)) codeGroups.set(key, { code, members: [] });
    codeGroups.get(key).members.push(player);
  }

  /** @type {Map<string, string>} codeBuddyByPlayerId */
  const codeBuddyByPlayerId = new Map();
  for (const { code, members: group } of codeGroups.values()) {
    const ids = group.map((player) => coerceId(player.id)).filter(Boolean);
    if (group.length === 1) {
      diagnostics.push({
        code: 'buddy-code-unmatched',
        severity: 'info',
        message: `buddy code "${code}" was entered by only one player`,
        playerIds: ids,
      });
      continue;
    }
    if (group.length > 2) {
      diagnostics.push({
        code: 'duplicate-buddy-code',
        severity: 'warning',
        message: `buddy code "${code}" is shared by ${group.length} players; codes must pair exactly two`,
        playerIds: ids,
      });
      continue;
    }
    const [a, b] = group;
    if (String(a.division) !== String(b.division)) {
      diagnostics.push({
        code: 'cross-division-buddy',
        severity: 'warning',
        message: `buddy code "${code}" pairs players in different divisions (${a.division} and ${b.division})`,
        playerIds: ids,
      });
      continue;
    }
    const aId = coerceId(a.id);
    const bId = coerceId(b.id);
    if (aId && bId && aId !== bId) {
      codeBuddyByPlayerId.set(aId, bId);
      codeBuddyByPlayerId.set(bId, aId);
    } else {
      diagnostics.push({
        code: 'buddy-code-unmatched',
        severity: 'warning',
        message: `buddy code "${code}" could not be linked (missing or duplicate player ids)`,
        playerIds: ids,
      });
    }
  }

  // A player's usable direct reference (self-references can never link). An external
  // buddy_request key resolves through the roster's external registration ids.
  const resolvedDirect = (p) => {
    const d = getCanonicalBuddyId(p);
    if (d !== undefined && d !== coerceId(p?.id)) return d;
    const requestKey = getBuddyRequestKey(p);
    const viaRequest = requestKey ? playerIdByExternalKey.get(requestKey) : undefined;
    return viaRequest !== undefined && viaRequest !== coerceId(p?.id) ? viaRequest : undefined;
  };

  // Canonicalize per player: explicit reference first, then code resolution. A code link is
  // honored only when the partner's OWN resolution points back (an explicit override on the
  // partner breaks the code pair for both sides, with a diagnostic).
  const normalized = list.map((player) => {
    const id = coerceId(player?.id);
    const direct = getCanonicalBuddyId(player);
    let buddyId = resolvedDirect(player);
    if (buddyId === undefined && id) {
      const codeBuddy = codeBuddyByPlayerId.get(id);
      if (codeBuddy) {
        const partner = byId.get(codeBuddy);
        const partnerResolved = partner
          ? (resolvedDirect(partner) ?? codeBuddyByPlayerId.get(codeBuddy))
          : undefined;
        if (partnerResolved === id) {
          buddyId = codeBuddy;
        } else {
          diagnostics.push({
            code: 'buddy-code-unmatched',
            severity: 'warning',
            message: `buddy code "${getBuddyCode(player)}" could not be linked: partner ${codeBuddy} has a different explicit buddy request`,
            playerIds: [id, codeBuddy],
          });
        }
      }
    }

    // An external buddy_request that matches no roster player is a lost request — diagnose it
    // (unless an explicit reference or code link already resolved the player).
    if (buddyId === undefined && direct === undefined && id) {
      const requestKey = getBuddyRequestKey(player);
      if (requestKey && !playerIdByExternalKey.has(requestKey)) {
        diagnostics.push({
          code: 'missing-buddy-target',
          severity: 'warning',
          message: `player ${id} requested buddy by external key "${requestKey}" which matches no player`,
          playerIds: [id],
        });
      }
    }

    if (direct && id) {
      if (direct === id) {
        diagnostics.push({
          code: 'self-buddy-reference',
          severity: 'warning',
          message: `player ${id} requested themself as buddy`,
          playerIds: [id],
        });
      } else {
        const target = byId.get(direct);
        if (!target) {
          diagnostics.push({
            code: 'missing-buddy-target',
            severity: 'warning',
            message: `player ${id} requested buddy ${direct} who is not in the player list`,
            playerIds: [id],
          });
        } else if (String(target.division) !== String(player.division)) {
          diagnostics.push({
            code: 'cross-division-buddy',
            severity: 'warning',
            message: `player ${id} (${player.division}) requested buddy ${direct} in division ${target.division}`,
            playerIds: [id, direct],
          });
        } else {
          // The reciprocation may arrive via the target's own direct reference OR a buddy code.
          const reciprocal = getCanonicalBuddyId(target) ?? codeBuddyByPlayerId.get(direct);
          if (reciprocal !== id) {
            diagnostics.push({
              code: 'one-sided-buddy',
              severity: 'info',
              message: `player ${id} requested buddy ${direct} but the request is not reciprocated`,
              playerIds: [id, direct],
            });
          }
        }
      }
    }

    // Store the canonical value when it differs from the raw field, so downstream strict
    // comparisons (unit building, conflict detection) see the trimmed/canonical id. Non-string
    // raw values that already coerce to the canonical form are left as-is (numeric-id rosters
    // match by raw value downstream).
    const raw = player?.buddyId;
    const rawMatchesCanonical =
      typeof raw === 'string' ? raw === buddyId : coerceId(raw) === buddyId;
    if (buddyId !== undefined && !rawMatchesCanonical) {
      return { ...player, buddyId };
    }
    return player;
  });

  return { players: normalized, diagnostics };
}

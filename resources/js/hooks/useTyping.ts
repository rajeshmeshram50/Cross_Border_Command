import { useCallback, useEffect, useRef, useState } from 'react';
import { getEcho } from '../echo';
import { useAuth } from '../contexts/AuthContext';

/*
 * Live "is typing…" indicator over Reverb client (whisper) events.
 *
 * Whispers ride the *existing* private channel `clm.approvals.{clientId}` that
 * the Agreements-to-Approve / Agreements-Sent pages already subscribe to — so
 * there is no backend event, route, controller or DB write involved. Reverb
 * relays them client→client because `accept_client_events_from` is `members`
 * (config/reverb.php) and our channel is private.
 *
 * Scoped per contract: every whisper carries `contractId`, and listeners ignore
 * whispers for any other contract (and their own user id), so two people in two
 * different conversations never see each other's typing.
 *
 * `expect` narrows it further, to the party we are actually in conversation
 * with. The channel is per-TENANT (`clm.approvals.{clientId}`), not per
 * contract, so every user of the tenant is on it — anyone who happens to have
 * an agreements page open is one contractId away from appearing in this modal
 * as "…is typing", and a hand-written whisper from the console could put any
 * name there at all. Pass the counterparty's name(s) and a whisper from anyone
 * else is dropped.
 *
 * The name RENDERED is the one the caller passed, never the one in the payload,
 * so the indicator can only ever show a name the page already trusted. Note the
 * limit: whispers are client-to-client with no server in the path, so a user who
 * knows the counterparty's name can still forge a "typing" flicker. That is the
 * ceiling for a cosmetic indicator built on whispers — it cannot assert who is
 * typing, only that a claim was made. Nothing is read from the payload and
 * nothing is written, so a forged whisper costs a flicker and nothing else.
 */
export function useTyping(
  contractId: string | number | null | undefined,
  opts?: { expect?: (string | null | undefined)[] },
) {
  const { user } = useAuth();
  const [typingName, setTypingName] = useState<string | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);   // local: schedule my own "stopped"
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  // remote: safety auto-clear

  const clientId = user?.client_id;
  const channelName = clientId ? `clm.approvals.${clientId}` : null;
  const me = user?.id;
  const myName = user?.name ?? 'Someone';

  /* Names we will accept a whisper from, normalised for comparison. Joined into
     a string so the effect below re-runs when the set genuinely changes rather
     than on every render — callers build this array inline. */
  const expectKey = (opts?.expect ?? [])
    .map(n => (n ?? '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');

  // Listen for the OTHER party's typing whispers on the shared channel.
  useEffect(() => {
    const echo = getEcho();
    if (!echo || !channelName || contractId == null) return;
    const allowed = expectKey ? new Set(expectKey.split('|')) : null;
    const ch = echo.private(channelName);
    const onWhisper = (e: { contractId: string | number; userId: number; name: string; typing: boolean }) => {
      if (String(e.contractId) !== String(contractId)) return; // a different contract's conversation
      if (e.userId === me) return;                             // my own whisper echoed back
      const who = (e.name ?? '').trim().toLowerCase();
      // Not a party to THIS conversation — a colleague elsewhere in the tenant,
      // or a forged whisper. Either way it is not news about this agreement.
      if (allowed && !allowed.has(who)) return;
      if (e.typing) {
        /* Render the caller's own copy of the name, not the payload's. The two
           match here by definition (that is what `allowed` just checked), so
           this costs nothing and keeps a remote string out of the DOM. */
        const label = (opts?.expect ?? []).find(n => (n ?? '').trim().toLowerCase() === who);
        setTypingName(label || e.name || 'Someone');
        if (clearTimer.current) clearTimeout(clearTimer.current);
        // Safety net: clear the indicator even if the "stopped" whisper is lost.
        clearTimer.current = setTimeout(() => setTypingName(null), 4000);
      } else {
        setTypingName(null);
        if (clearTimer.current) clearTimeout(clearTimer.current);
      }
    };
    ch.listenForWhisper('typing', onWhisper);
    return () => {
      // Remove ONLY the whisper listener — never echo.leave(), or we'd tear down
      // the page-level `approval.updated` subscription that shares this channel.
      ch.stopListeningForWhisper('typing', onWhisper);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setTypingName(null);
    };
  }, [channelName, contractId, me]);

  // Call on every keystroke. Sends typing:true now, then a typing:false ~2s
  // after the last keystroke (debounced).
  const notifyTyping = useCallback(() => {
    const echo = getEcho();
    if (!echo || !channelName || contractId == null) return;
    const ch = echo.private(channelName);
    ch.whisper('typing', { contractId, userId: me, name: myName, typing: true });
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      ch.whisper('typing', { contractId, userId: me, name: myName, typing: false });
    }, 2000);
  }, [channelName, contractId, me, myName]);

  // Explicit stop — call on submit / close so the indicator clears immediately.
  const stopTyping = useCallback(() => {
    const echo = getEcho();
    if (!echo || !channelName || contractId == null) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    echo.private(channelName).whisper('typing', { contractId, userId: me, name: myName, typing: false });
  }, [channelName, contractId, me, myName]);

  return { typingName, notifyTyping, stopTyping };
}

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
 */
export function useTyping(contractId: string | number | null | undefined) {
  const { user } = useAuth();
  const [typingName, setTypingName] = useState<string | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);   // local: schedule my own "stopped"
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  // remote: safety auto-clear

  const clientId = user?.client_id;
  const channelName = clientId ? `clm.approvals.${clientId}` : null;
  const me = user?.id;
  const myName = user?.name ?? 'Someone';

  // Listen for the OTHER party's typing whispers on the shared channel.
  useEffect(() => {
    const echo = getEcho();
    if (!echo || !channelName || contractId == null) return;
    const ch = echo.private(channelName);
    const onWhisper = (e: { contractId: string | number; userId: number; name: string; typing: boolean }) => {
      if (String(e.contractId) !== String(contractId)) return; // a different contract's conversation
      if (e.userId === me) return;                             // my own whisper echoed back
      if (e.typing) {
        setTypingName(e.name || 'Someone');
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

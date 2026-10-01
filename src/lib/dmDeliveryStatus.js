// src/lib/dmDeliveryStatus.js
//
// Delivery status for the sender's own message — the iMessage-style
// tick in the conversation list.
//
// Three states, each backed by something the database actually knows.
// Nothing here infers or guesses: a tick that lies is worse than no tick.
//
//   'sent'      grey check   — the hub_messages row exists. The insert
//                              succeeded and the server has it.
//   'delivered' green check  — hub_messages.delivered_at (mig 237),
//                              stamped when the RECIPIENT's client
//                              downloaded the message row.
//   'read'      green eye    — hub_messages.read_at, stamped by mig
//                              141's mark_message_read when the
//                              recipient actually opened the thread.
//
// Returns null when there is nothing honest to show:
//   • no message yet
//   • the last message is theirs, not mine — you never display read
//     state for messages you RECEIVED
//   • the row is still optimistic (client-side temp id), so the server
//     has not confirmed the insert and even 'sent' would be a guess
//
// Group threads return null too: delivered_at / read_at are single
// timestamps, so with 3+ participants they'd mean "somebody", which is
// not a claim worth rendering.

export const DM_STATUS_SENT      = 'sent';
export const DM_STATUS_DELIVERED = 'delivered';
export const DM_STATUS_READ      = 'read';

/**
 * RECIPROCITY (mig 238): a viewer who has turned read receipts OFF also
 * stops SEEING other people's read state. Otherwise the setting is a
 * one-way mirror — you harvest everyone's read status while hiding your
 * own — which is the deal WhatsApp and iMessage both refuse to offer.
 *
 * The suppression falls back to 'delivered' rather than 'sent': the
 * message demonstrably reached them, and read implies delivered, so
 * downgrading all the way to a grey check would understate what we
 * honestly know. Only the read/eye state is withheld.
 *
 * @param {object|null} message       the conversation's latest message row
 * @param {string} myId               the viewer's user id
 * @param {object} [opts]
 * @param {boolean} [opts.isGroup]    suppress ticks on group threads
 * @param {boolean} [opts.readReceiptsEnabled]  the VIEWER's own setting;
 *   false withholds the read state. Defaults true so a pre-238 host, a
 *   loading profile, or a missing column behaves exactly as before.
 * @returns {'sent'|'delivered'|'read'|null}
 */
export function deriveDeliveryStatus(
  message,
  myId,
  { isGroup = false, readReceiptsEnabled = true } = {},
) {
  if (!message || !myId) return null;
  if (isGroup) return null;

  // Optimistic rows carry a temp id and `_optimistic`; the insert may
  // still fail, so claiming 'sent' would be premature.
  if (message._optimistic) return null;
  if (typeof message.id === 'string' && message.id.startsWith('temp-')) return null;

  // user_id is the sender (the email columns are not readable).
  if (!message.user_id || String(message.user_id) !== String(myId)) return null;

  if (message.read_at) {
    // Reciprocity: receipts off means no eye, in either direction.
    return readReceiptsEnabled ? DM_STATUS_READ : DM_STATUS_DELIVERED;
  }
  if (message.delivered_at) return DM_STATUS_DELIVERED;
  return DM_STATUS_SENT;
}

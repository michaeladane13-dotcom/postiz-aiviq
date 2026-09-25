export function extractMetaEvents(payload) {
  const events = [];
  const object = payload?.object;
  for (const entry of payload?.entry || []) {
    const changes = Array.isArray(entry.changes)
      ? entry.changes
      : entry.field
        ? [{ field: entry.field, value: entry.value }]
        : [];

    for (const change of changes) {
      const value = change?.value || {};
      if (object === 'instagram' && ['comments', 'live_comments'].includes(change.field)) {
        events.push({
          kind: 'comment',
          platform: 'instagram',
          metaAccountId: String(entry.id),
          commentId: String(value.id || ''),
          text: String(value.text || ''),
          username: String(value.from?.username || value.from?.id || ''),
          senderId: String(value.from?.id || ''),
          postId: String(value.media?.id || ''),
          timestamp: value.timestamp ? Date.parse(value.timestamp) : Date.now(),
          raw: { object, entryId: entry.id, change },
        });
      }

      if (
        object === 'page' &&
        change.field === 'feed' &&
        value.item === 'comment' &&
        value.verb === 'add'
      ) {
        events.push({
          kind: 'comment',
          platform: 'facebook',
          metaAccountId: String(entry.id),
          commentId: String(value.comment_id || ''),
          text: String(value.message || ''),
          username: String(value.sender_name || value.from?.name || ''),
          senderId: String(value.sender_id || value.from?.id || ''),
          postId: String(value.post_id || value.parent_id || ''),
          timestamp: value.created_time
            ? Number(value.created_time) * 1000 || Date.parse(value.created_time)
            : Date.now(),
          raw: { object, entryId: entry.id, change },
        });
      }
    }

    for (const messagingEvent of entry.messaging || []) {
      const platform = object === 'instagram' ? 'instagram' : object === 'page' ? 'facebook' : '';
      const metaAccountId = String(entry.id || messagingEvent.recipient?.id || '');
      const senderId = String(messagingEvent.sender?.id || '');
      const timestamp = Number(messagingEvent.timestamp || Date.now());
      if (platform && messagingEvent.message && !messagingEvent.message.is_echo) {
        events.push({
          kind: 'message',
          platform,
          metaAccountId,
          messageId: String(messagingEvent.message.mid || ''),
          text: String(messagingEvent.message.text || ''),
          senderId,
          recipientId: String(messagingEvent.recipient?.id || ''),
          timestamp,
          raw: { object, entryId: entry.id, messagingEvent },
        });
      }
      if (platform && messagingEvent.optin) {
        events.push({
          kind: 'marketing_optin',
          platform,
          metaAccountId,
          messageId: String(
            messagingEvent.optin.notification_messages_token ||
            messagingEvent.optin.token ||
            `optin:${senderId}:${timestamp}`
          ),
          senderId,
          recipientId: String(messagingEvent.recipient?.id || ''),
          timestamp,
          marketingToken: String(
            messagingEvent.optin.notification_messages_token || messagingEvent.optin.token || ''
          ),
          raw: { object, entryId: entry.id, messagingEvent },
        });
      }
    }
  }

  return events.filter((event) => {
    if (!event.metaAccountId) return false;
    if (event.kind === 'comment') return Boolean(event.commentId);
    if (event.kind === 'message') return Boolean(event.messageId && event.senderId);
    if (event.kind === 'marketing_optin') return Boolean(event.senderId && event.marketingToken);
    return false;
  });
}

import { redisConnection } from '../../config/redis.config.js';

export function subscribeLessonEvents(lessonId, onEvent) {
  const channel = `lesson:generation:${lessonId}`;
  const subscriber = redisConnection.duplicate();

  subscriber.on('message', (receivedChannel, message) => {
    if (receivedChannel !== channel) return;
    try {
      onEvent(JSON.parse(message));
    } catch {
      // Malformed payload — drop it, never crash the stream over one bad message.
    }
  });

  const subscribed = subscriber.subscribe(channel);

  return {
    subscribed,
    close: () => subscriber.quit(),
  };
}
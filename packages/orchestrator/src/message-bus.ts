import { EventEmitter } from "node:events";

export interface BusMessage {
  from: string;
  to?: string;
  topic: string;
  payload: unknown;
  timestamp: number;
}

export class MessageBus {
  private emitter = new EventEmitter();

  publish(message: Omit<BusMessage, "timestamp">): void {
    const full: BusMessage = { ...message, timestamp: Date.now() };
    this.emitter.emit(message.topic, full);
    if (message.to) {
      this.emitter.emit(`agent:${message.to}`, full);
    }
  }

  subscribe(topic: string, handler: (message: BusMessage) => void): () => void {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }

  subscribeAgent(
    agentName: string,
    handler: (message: BusMessage) => void,
  ): () => void {
    const channel = `agent:${agentName}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  once(topic: string): Promise<BusMessage> {
    return new Promise((resolve) => {
      this.emitter.once(topic, resolve);
    });
  }
}
